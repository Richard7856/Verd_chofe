import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { Stepper } from '@/components/Stepper'
import { PhotoSlot } from '@/components/PhotoSlot'
import { BlobImage } from '@/components/BlobImage'
import { NumberField } from '@/components/NumberField'
import { Button, Card, Field, Input, SectionTitle, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { currentCoords } from '@/lib/capture'
import { liters as fmtLiters, money, shortDate, todayISO, unidadLabel } from '@/lib/format'
import {
  deleteDraft,
  deletePhoto,
  enqueue,
  estaEncolado,
  getActiveDraft,
  getPhotos,
  newClientUuid,
  saveDraft,
  savePhoto,
  type FuelDraft,
  type StoredPhoto,
} from '@/lib/offline'
import type { SolicitudCombustible } from '@/lib/database.types'

const STEPS = ['Ticket', 'Datos', 'Confirmar']

/** Margen sobre lo autorizado antes de marcarlo: la bomba redondea. */
const TOLERANCIA_LITROS = 1

function borradorNuevo(solicitud: SolicitudCombustible): FuelDraft {
  return {
    clientUuid: newClientUuid(),
    kind: 'fuel',
    step: 0,
    vehicleId: solicitud.unidad_id,
    checklistId: solicitud.checklist_id,
    solicitudId: solicitud.id,
    loadedOn: todayISO(),
    // Lo pedido viene precargado para que el chofer corrija sobre el ticket
    // en vez de tipear todo de nuevo — y para que la diferencia contra lo
    // autorizado sea un cambio deliberado, no un descuido.
    stationName: solicitud.estacion,
    liters: solicitud.litros_autorizados ?? solicitud.litros,
    pricePerLiter: null,
    totalAmount: null,
    odometer: solicitud.km,
    folio: null,
    lat: solicitud.lat,
    lng: solicitud.lng,
    updatedAt: Date.now(),
  }
}

/**
 * Segunda mitad del circuito: la carga ya está autorizada y el chofer sube el
 * comprobante. Es el mismo formulario de siempre; lo que cambia es que ahora
 * cuelga de una solicitud y se puede contrastar contra lo que se autorizó.
 */
export function EvidenciaCarga({
  solicitud,
  estaciones,
  onListo,
}: {
  solicitud: SolicitudCombustible
  estaciones: string[]
  onListo: () => void
}) {
  const navigate = useNavigate()
  const { unidad } = useAuth()
  const { sync, refreshPending, online, pending } = useSync()

  const [draft, setDraft] = useState<FuelDraft | null>(null)
  const [ticket, setTicket] = useState<StoredPhoto | null>(null)
  const [preparando, setPreparando] = useState(true)
  const [yaEnviada, setYaEnviada] = useState(false)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let vivo = true

    async function preparar() {
      const existente = await getActiveDraft('fuel')

      if (existente?.kind === 'fuel' && existente.solicitudId === solicitud.id) {
        if (await estaEncolado(existente.clientUuid, 'fuel')) {
          // Ya se mandó y espera señal. Mostrarle el formulario otra vez lo
          // llevaría a "guardar" de nuevo algo que ya está guardado.
          if (vivo) setYaEnviada(true)
          if (vivo) setPreparando(false)
          return
        }
        const fotos = await getPhotos(existente.clientUuid)
        if (!vivo) return
        setDraft(existente)
        setTicket(fotos.find((f) => f.slotCode === 'ticket') ?? null)
        setPreparando(false)
        return
      }

      // Borrador de otra solicitud que quedó sin enviar: se descarta. Los
      // borradores fantasma ya nos costaron un turno que no cerraba.
      if (existente?.kind === 'fuel' && !(await estaEncolado(existente.clientUuid, 'fuel'))) {
        await deleteDraft(existente.clientUuid)
      }

      const fresco = borradorNuevo(solicitud)
      const coords = await currentCoords(5000)
      fresco.lat = coords.lat ?? fresco.lat
      fresco.lng = coords.lng ?? fresco.lng
      await saveDraft(fresco)
      if (!vivo) return
      setDraft(fresco)
      setTicket(null)
      setPreparando(false)
    }

    void preparar()
    return () => {
      vivo = false
    }
    // Sólo el id: la solicitud se re-consulta cada tanto y el objeto cambia de
    // identidad aunque sea la misma. Reejecutar esto tiraría el borrador que
    // el chofer está llenando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud.id])

  const patch = useCallback((changes: Partial<FuelDraft>) => {
    setDraft((current) => {
      if (!current) return current
      const next = { ...current, ...changes, updatedAt: Date.now() }
      void saveDraft(next)
      return next
    })
  }, [])

  async function captureTicket(blob: Blob) {
    if (!draft) return
    const coords = await currentCoords(4000)

    const photo: StoredPhoto = {
      key: `${draft.clientUuid}:ticket`,
      clientUuid: draft.clientUuid,
      slotCode: 'ticket',
      label: 'Ticket de compra',
      blob,
      takenAt: new Date().toISOString(),
      lat: coords.lat,
      lng: coords.lng,
    }

    await savePhoto(photo)
    setTicket(photo)
  }

  async function submit() {
    if (!draft) return
    setSubmitting(true)
    try {
      await enqueue(draft.clientUuid, 'fuel')
      await refreshPending()
      setDone(true)
      void sync()
    } finally {
      setSubmitting(false)
    }
  }

  if (preparando) return <Spinner label="Preparando…" />

  // ------------------------------------------------------ ya se mandó
  if (yaEnviada) {
    return (
      <div className="min-h-dvh bg-surface-alt">
        <WizardHeader title="Carga de combustible" onBack={() => navigate('/')} />
        <div className="space-y-4 p-4">
          <Card className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-accent-600">
              <Icon name="cloudOff" size={30} />
            </span>
            <p className="font-bold text-ink">Tu carga está esperando señal</p>
            <p className="max-w-xs text-sm text-body-soft">
              Ya la guardaste. Se envía sola en cuanto el teléfono tenga datos; no hace falta
              cargarla de nuevo.
            </p>
          </Card>
          <Button onClick={() => void sync()}>Intentar enviar ahora</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Volver al inicio
          </Button>
        </div>
      </div>
    )
  }

  if (!draft) return <Spinner label="Preparando…" />

  // ------------------------------------------------------------ final
  if (done) {
    const enCola = !online || pending > 0

    return (
      <div className="safe-top flex min-h-dvh flex-col justify-between p-4">
        <div className="space-y-4 pt-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-500 text-white">
              <Icon name="check" size={40} strokeWidth={2.5} />
            </span>
            <h1 className="text-[22px] font-extrabold text-ink">¡Carga registrada!</h1>
            <p className="max-w-xs text-sm text-body-soft">
              {enCola
                ? 'Se guardó en tu teléfono y se envía solo al recuperar señal.'
                : 'El registro se guardó correctamente.'}
            </p>
          </div>

          <Card>
            <p className="mb-1 font-bold text-brand-600">Detalle del registro</p>
            <div className="divide-y divide-gray-100">
              <SummaryRow label="Fecha" value={shortDate(draft.loadedOn)} />
              <SummaryRow label="Estación" value={draft.stationName || '—'} />
              <SummaryRow label="Litros" value={fmtLiters(draft.liters)} />
              <SummaryRow label="Total" value={money(draft.totalAmount)} />
              <SummaryRow label="Unidad" value={unidadLabel(unidad)} />
            </div>
          </Card>
        </div>

        <div className="safe-bottom space-y-2 pt-6">
          <Button onClick={() => navigate('/registros')}>Ver mis registros</Button>
          <Button variant="secondary" onClick={onListo}>
            Volver a combustible
          </Button>
        </div>
      </div>
    )
  }

  const total =
    draft.liters != null && draft.pricePerLiter != null ? draft.liters * draft.pricePerLiter : null

  const datosListos = draft.liters != null && draft.pricePerLiter != null && draft.liters > 0

  const autorizados = solicitud.litros_autorizados ?? solicitud.litros
  const seExcede =
    autorizados != null && draft.liters != null && draft.liters > autorizados + TOLERANCIA_LITROS

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <WizardHeader title="Evidencia de la carga" onBack={() => navigate('/')} />
      <Stepper steps={STEPS} current={draft.step} onSelect={(index) => patch({ step: index })} />

      {/* ---------------------------------------------------- paso 1 */}
      {draft.step === 0 && (
        <>
          <div className="flex-1 space-y-3 p-4">
            <SectionTitle hint="Tomá una foto clara del ticket de compra.">
              Foto del ticket
            </SectionTitle>

            <div className="mx-auto max-w-[240px]">
              <PhotoSlot
                label="Ticket de compra"
                blob={ticket?.blob ?? null}
                onCapture={captureTicket}
                onClear={async () => {
                  await deletePhoto(`${draft.clientUuid}:ticket`)
                  setTicket(null)
                }}
              />
            </div>
          </div>

          <Footer
            onNext={() => patch({ step: 1 })}
            disabled={!ticket}
            hint={!ticket ? 'Tomá la foto del ticket para continuar' : undefined}
          />
        </>
      )}

      {/* ---------------------------------------------------- paso 2 */}
      {draft.step === 1 && (
        <>
          <div className="flex-1 space-y-4 p-4">
            {autorizados != null && (
              <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
                <Icon name="checkCircle" size={17} className="mt-0.5 shrink-0" />
                Tenés autorizados {fmtLiters(autorizados)}. Poné lo que dice el ticket, aunque no
                coincida.
              </p>
            )}

            <Field label="Fecha de carga">
              <Input
                icon="calendar"
                type="date"
                value={draft.loadedOn}
                max={todayISO()}
                onChange={(event) => patch({ loadedOn: event.target.value })}
              />
            </Field>

            <Field label="Estación de servicio">
              <Input
                icon="mapPin"
                list="estaciones"
                placeholder="Shell - Sucursal Norte"
                value={draft.stationName ?? ''}
                onChange={(event) => patch({ stationName: event.target.value || null })}
              />
            </Field>
            <datalist id="estaciones">
              {estaciones.map((estacion) => (
                <option key={estacion} value={estacion} />
              ))}
            </datalist>

            <Field
              label="Litros cargados"
              hint={seExcede ? undefined : 'Tal cual salen en el ticket.'}
              error={
                seExcede
                  ? `Son más litros de los autorizados (${fmtLiters(autorizados)}). Podés seguir, pero queda marcado para revisión.`
                  : undefined
              }
            >
              <NumberField
                decimales
                icon="droplet"
                suffix="Lts"
                placeholder="40.00"
                value={draft.liters}
                onChange={(value) => patch({ liters: value })}
              />
            </Field>

            <Field label="Precio por litro">
              <NumberField
                decimales
                icon="fuel"
                suffix="$ / L"
                placeholder="6.890"
                value={draft.pricePerLiter}
                onChange={(value) => patch({ pricePerLiter: value })}
              />
            </Field>

            {/* El total se calcula: escribirlo a mano es una fuente de errores. */}
            <Field label="Total" hint="Se calcula con litros × precio por litro.">
              <Input readOnly suffix="$" value={total != null ? total.toFixed(2) : ''} />
            </Field>

            <Field label="Kilometraje (opcional)">
              <NumberField
                icon="gauge"
                suffix="km"
                placeholder="45230"
                value={draft.odometer}
                onChange={(value) => patch({ odometer: value })}
              />
            </Field>
          </div>

          <Footer
            onNext={() => patch({ step: 2, totalAmount: total })}
            disabled={!datosListos}
            hint={!datosListos ? 'Completá litros y precio por litro' : undefined}
          />
        </>
      )}

      {/* ---------------------------------------------------- paso 3 */}
      {draft.step === 2 && (
        <>
          <div className="flex-1 space-y-3 p-4">
            <SectionTitle>Resumen de la carga</SectionTitle>

            <Card className="flex gap-3">
              <BlobImage
                blob={ticket?.blob ?? null}
                alt="Ticket de compra"
                className="h-28 w-20 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1 divide-y divide-gray-100">
                <SummaryRow label="Fecha" value={shortDate(draft.loadedOn)} />
                <SummaryRow label="Estación" value={draft.stationName || '—'} />
                <SummaryRow label="Litros" value={fmtLiters(draft.liters)} />
                <SummaryRow label="Precio / L" value={money(draft.pricePerLiter)} />
                <SummaryRow label="Total" value={money(total)} />
              </div>
            </Card>

            {seExcede && (
              <p className="flex items-start gap-2 rounded-xl bg-orange-50 px-3.5 py-2.5 text-sm text-accent-600">
                <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
                Cargaste más de lo autorizado ({fmtLiters(autorizados)}). El panel lo va a marcar.
              </p>
            )}

            <Card>
              <SummaryRow label="Unidad" value={unidadLabel(unidad)} />
              <SummaryRow label="Autorizado" value={fmtLiters(autorizados)} />
            </Card>
          </div>

          <div className="safe-bottom sticky bottom-0 space-y-2 border-t border-gray-100 bg-white px-4 py-3">
            <Button variant="secondary" onClick={() => patch({ step: 1 })}>
              Editar información
            </Button>
            <Button variant="success" loading={submitting} onClick={() => void submit()}>
              Guardar registro
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="shrink-0 text-body-soft">{label}</span>
      <span className="truncate text-right font-medium text-ink">{value}</span>
    </div>
  )
}

function Footer({
  onNext,
  disabled,
  hint,
}: {
  onNext: () => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <div className="safe-bottom sticky bottom-0 border-t border-gray-100 bg-white px-4 py-3">
      {hint && <p className="mb-2 text-center text-xs text-body-soft">{hint}</p>}
      <Button onClick={onNext} disabled={disabled}>
        Siguiente
      </Button>
    </div>
  )
}
