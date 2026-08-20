import { supabase, BUCKET_EVIDENCIAS } from './supabase'
import {
  deleteDraft,
  deletePhotosOf,
  dequeue,
  getDraft,
  getOutbox,
  getPhotos,
  markOutbox,
  saveDraft,
  type ChecklistDraft,
  type FuelDraft,
  type GastoDraft,
} from './offline'

export interface SyncContext {
  choferId: string
  empresaId: string
}

/**
 * Los errores de supabase-js NO son instancias de `Error`: son objetos planos
 * `{ message, details, hint, code }`. Un `String(error)` los convierte en
 * "[object Object]", que fue exactamente lo que ocultó durante días por qué
 * no subía nada. Acá se extrae algo que un humano pueda leer.
 */
function mensajeDeError(error: unknown): string {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    const e = error as { message?: string; details?: string; hint?: string; code?: string }
    const partes = [e.message, e.details, e.hint].filter(Boolean)
    if (partes.length > 0) {
      return partes.join(' — ') + (e.code ? ` (${e.code})` : '')
    }
    try {
      return JSON.stringify(error)
    } catch {
      return 'Error desconocido'
    }
  }

  return String(error)
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
 * La apertura se procesa siempre antes que el cierre del mismo check list:
 * el cierre sólo actualiza una fila que la apertura ya tiene que haber creado.
 */
export async function flushOutbox(ctx: SyncContext): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 }

  const orden = { checklist_apertura: 0, fuel: 1, gasto: 1, checklist_cierre: 2 }
  const entries = (await getOutbox()).sort((a, b) => orden[a.kind] - orden[b.kind])

  let synced = 0
  let failed = 0

  for (const entry of entries) {
    if (entry.status === 'syncing') continue

    await markOutbox(entry.id, { status: 'syncing' })
    try {
      const draft = await getDraft(entry.clientUuid)
      if (!draft) {
        await dequeue(entry.id)
        continue
      }

      if (entry.kind === 'checklist_apertura' && draft.kind === 'checklist') {
        await pushApertura(draft, ctx)
      } else if (entry.kind === 'checklist_cierre' && draft.kind === 'checklist') {
        await pushCierre(draft, ctx)
      } else if (entry.kind === 'fuel' && draft.kind === 'fuel') {
        await pushCarga(draft, ctx)
      } else if (entry.kind === 'gasto' && draft.kind === 'gasto') {
        await pushGasto(draft, ctx)
      }

      await dequeue(entry.id)
      synced++
    } catch (error) {
      failed++
      await markOutbox(entry.id, {
        status: 'failed',
        attempts: entry.attempts + 1,
        lastError: mensajeDeError(error),
      })
    }
  }

  return { synced, failed }
}

/**
 * Apertura: crea el check list en `en_progreso` con entrada, condiciones y
 * fotos. El borrador NO se borra — el cierre lo necesita para el resumen.
 */
async function pushApertura(draft: ChecklistDraft, ctx: SyncContext) {
  // Red de seguridad: la unidad es obligatoria en el paso de entrada, así que
  // esto no debería ocurrir. Si ocurre, el mensaje tiene que decirle al chofer
  // qué hacer, no dejarlo con un registro que reintenta para siempre.
  if (!draft.vehicleId) {
    throw new Error(
      'Este check list se guardó sin unidad y no se puede enviar. Empezá uno nuevo eligiendo tu unidad.',
    )
  }

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
        cliente_uuid: draft.clientUuid,
      },
      { onConflict: 'empresa_id,cliente_uuid' },
    )
    .select('id')
    .single()

  if (error) throw error
  const checklistId = checklist.id

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

  // Ya están en Storage: liberan espacio en el teléfono.
  await deletePhotosOf(draft.clientUuid)

  await saveDraft({ ...draft, remoteId: checklistId, aperturaEnviada: true })
}

/**
 * Cierre: completa salida y firma, y pasa el check list a `completado`.
 * Recién acá se borra el borrador.
 */
async function pushCierre(draft: ChecklistDraft, ctx: SyncContext) {
  // Si el cierre llegó antes que la apertura (cola desordenada por un fallo
  // previo), se resuelve el id por cliente_uuid en vez de fallar.
  let checklistId = draft.remoteId
  if (!checklistId) {
    const { data } = await supabase
      .from('checklists_unidad')
      .select('id')
      .eq('empresa_id', ctx.empresaId)
      .eq('cliente_uuid', draft.clientUuid)
      .maybeSingle()

    if (!data) throw new Error('La apertura de este check list todavía no se sincronizó')
    checklistId = data.id
  }

  // Las fotos del cierre (el tablero con el kilometraje final) van ANTES de
  // marcar el turno como completado: las políticas RLS sólo permiten escribir
  // fotos mientras el check list está `en_progreso`.
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

  let firmaRuta: string | null = null
  if (draft.signature) {
    firmaRuta = `${ctx.empresaId}/${checklistId}/firma.png`
    const { error: firmaError } = await supabase.storage
      .from(BUCKET_EVIDENCIAS)
      .upload(firmaRuta, draft.signature, { contentType: 'image/png', upsert: true })
    if (firmaError) throw firmaError
  }

  const { error } = await supabase
    .from('checklists_unidad')
    .update({
      estado: 'completado',
      salida_el: draft.exitAt,
      km_final: draft.odometerEnd,
      salida_lat: draft.exitLat,
      salida_lng: draft.exitLng,
      ruta_turno: draft.shiftLabel,
      observaciones: draft.observations,
      firma_ruta: firmaRuta,
      firmado_el: draft.signedAt,
      completado_el: new Date().toISOString(),
    })
    .eq('id', checklistId)

  if (error) throw error

  await deleteDraft(draft.clientUuid)
}

async function pushGasto(draft: GastoDraft, ctx: SyncContext) {
  if (!draft.vehicleId) throw new Error('El gasto no tiene unidad asignada')
  if (!draft.monto || draft.monto <= 0) throw new Error('Falta el monto del gasto')

  const fotos = await getPhotos(draft.clientUuid)
  const ticket = fotos.find((f) => f.slotCode === 'ticket')

  let ticketRuta: string | null = null
  if (ticket) {
    ticketRuta = `${ctx.empresaId}/gastos/${draft.clientUuid}.jpg`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_EVIDENCIAS)
      .upload(ticketRuta, ticket.blob, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) throw uploadError
  }

  const { error } = await supabase.from('gastos_chofer').upsert(
    {
      empresa_id: ctx.empresaId,
      chofer_id: ctx.choferId,
      unidad_id: draft.vehicleId,
      checklist_id: draft.checklistId,
      fecha: draft.fecha,
      tipo: draft.tipo,
      descripcion: draft.descripcion,
      monto: draft.monto,
      lugar: draft.lugar,
      folio: draft.folio,
      km: draft.km,
      ticket_ruta: ticketRuta,
      lat: draft.lat,
      lng: draft.lng,
      cliente_uuid: draft.clientUuid,
    },
    { onConflict: 'empresa_id,cliente_uuid' },
  )

  if (error) throw error

  await deleteDraft(draft.clientUuid)
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
      checklist_id: draft.checklistId,
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

  await deleteDraft(draft.clientUuid)
}
