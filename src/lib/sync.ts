import { supabase, BUCKET_EVIDENCIAS } from './supabase'
import {
  deleteDraft,
  dequeue,
  getDraft,
  getOutbox,
  getPhotos,
  markOutbox,
  type ChecklistDraft,
  type FuelDraft,
} from './offline'

export interface SyncContext {
  choferId: string
  empresaId: string
}

/**
 * Sube todo lo que quedó en la cola. Es idempotente de punta a punta:
 *
 *   - `checklists_unidad` y `cargas_combustible` tienen UNIQUE (empresa_id, cliente_uuid)
 *   - `checklist_unidad_items` tiene UNIQUE (checklist_id, codigo)
 *   - `checklist_unidad_fotos` tiene UNIQUE (checklist_id, codigo)
 *
 * Así, si se corta la señal a mitad del envío, reintentar no duplica nada.
 *
 * El orden importa: el check list se inserta como `en_progreso`, después van
 * ítems y fotos, y recién al final pasa a `completado`. Las políticas RLS sólo
 * dejan escribir ítems y fotos mientras el check list está en progreso.
 */
export async function flushOutbox(ctx: SyncContext): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 }

  const entries = await getOutbox()
  let synced = 0
  let failed = 0

  for (const entry of entries) {
    if (entry.status === 'syncing') continue

    await markOutbox(entry.clientUuid, { status: 'syncing' })
    try {
      const draft = await getDraft(entry.clientUuid)
      if (!draft) {
        await dequeue(entry.clientUuid)
        continue
      }

      if (draft.kind === 'checklist') {
        await pushChecklist(draft, ctx)
      } else {
        await pushCarga(draft, ctx)
      }

      await deleteDraft(entry.clientUuid)
      await dequeue(entry.clientUuid)
      synced++
    } catch (error) {
      failed++
      await markOutbox(entry.clientUuid, {
        status: 'failed',
        attempts: entry.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { synced, failed }
}

async function pushChecklist(draft: ChecklistDraft, ctx: SyncContext) {
  if (!draft.vehicleId) throw new Error('El check list no tiene unidad asignada')

  const { data: checklist, error } = await supabase
    .from('checklists_unidad')
    .upsert(
      {
        empresa_id: ctx.empresaId,
        chofer_id: ctx.choferId,
        unidad_id: draft.vehicleId,
        bodega_id: draft.depotId,
        estado: 'en_progreso',
        fecha: draft.checklistDate,
        entrada_el: draft.entryAt,
        km_inicial: draft.odometerStart,
        entrada_lat: draft.entryLat,
        entrada_lng: draft.entryLng,
        salida_el: draft.exitAt,
        km_final: draft.odometerEnd,
        salida_lat: draft.exitLat,
        salida_lng: draft.exitLng,
        ruta_turno: draft.shiftLabel,
        observaciones: draft.observations,
        cliente_uuid: draft.clientUuid,
      },
      { onConflict: 'empresa_id,cliente_uuid' },
    )
    .select('id')
    .single()

  if (error) throw error
  const checklistId = checklist.id

  // --- ítems de condiciones
  const items = Object.entries(draft.items).map(([codigo, valor], index) => ({
    checklist_id: checklistId,
    codigo,
    etiqueta: valor.label ?? codigo,
    estado: valor.status,
    nota: valor.note ?? null,
    orden: index * 10,
  }))

  if (items.length > 0) {
    const { error: itemsError } = await supabase
      .from('checklist_unidad_items')
      .upsert(items, { onConflict: 'checklist_id,codigo' })
    if (itemsError) throw itemsError
  }

  // --- fotos
  const fotos = await getPhotos(draft.clientUuid)
  for (const foto of fotos) {
    const ruta = `${ctx.empresaId}/${checklistId}/${foto.slotCode}.jpg`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_EVIDENCIAS)
      .upload(ruta, foto.blob, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) throw uploadError

    const { error: rowError } = await supabase.from('checklist_unidad_fotos').upsert(
      {
        checklist_id: checklistId,
        codigo: foto.slotCode,
        etiqueta: foto.label,
        ruta,
        tomada_el: foto.takenAt,
        lat: foto.lat,
        lng: foto.lng,
      },
      { onConflict: 'checklist_id,codigo' },
    )
    if (rowError) throw rowError
  }

  // --- firma
  let firmaRuta: string | null = null
  if (draft.signature) {
    firmaRuta = `${ctx.empresaId}/${checklistId}/firma.png`
    const { error: firmaError } = await supabase.storage
      .from(BUCKET_EVIDENCIAS)
      .upload(firmaRuta, draft.signature, { contentType: 'image/png', upsert: true })
    if (firmaError) throw firmaError
  }

  // --- cierre
  const { error: cierreError } = await supabase
    .from('checklists_unidad')
    .update({
      estado: 'completado',
      firma_ruta: firmaRuta,
      firmado_el: draft.signedAt,
      completado_el: new Date().toISOString(),
    })
    .eq('id', checklistId)

  if (cierreError) throw cierreError
}

async function pushCarga(draft: FuelDraft, ctx: SyncContext) {
  if (!draft.vehicleId) throw new Error('La carga no tiene unidad asignada')
  if (!draft.liters || !draft.pricePerLiter) throw new Error('Faltan litros o precio por litro')

  const fotos = await getPhotos(draft.clientUuid)
  const ticket = fotos.find((f) => f.slotCode === 'ticket')

  let ticketRuta: string | null = null
  if (ticket) {
    ticketRuta = `${ctx.empresaId}/combustible/${draft.clientUuid}.jpg`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_EVIDENCIAS)
      .upload(ticketRuta, ticket.blob, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) throw uploadError
  }

  const { error } = await supabase.from('cargas_combustible').upsert(
    {
      empresa_id: ctx.empresaId,
      chofer_id: ctx.choferId,
      unidad_id: draft.vehicleId,
      fecha: draft.loadedOn,
      estacion: draft.stationName,
      litros: draft.liters,
      precio_litro: draft.pricePerLiter,
      total: draft.totalAmount ?? draft.liters * draft.pricePerLiter,
      km: draft.odometer,
      folio: draft.folio,
      ticket_ruta: ticketRuta,
      lat: draft.lat,
      lng: draft.lng,
      cliente_uuid: draft.clientUuid,
    },
    { onConflict: 'empresa_id,cliente_uuid' },
  )

  if (error) throw error
}
