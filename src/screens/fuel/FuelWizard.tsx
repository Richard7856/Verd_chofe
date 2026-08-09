import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { Stepper } from '@/components/Stepper'
import { PhotoSlot } from '@/components/PhotoSlot'
import { BlobImage } from '@/components/BlobImage'
import { Button, Card, Field, Input, SectionTitle, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { supabase } from '@/lib/supabase'
import { currentCoords } from '@/lib/capture'
import { liters as fmtLiters, money, parseNumber, shortDate, todayISO, unidadLabel } from '@/lib/format'
import {
  deletePhoto,
  enqueue,
  getActiveDraft,
  getPhotos,
  newClientUuid,
  saveDraft,
  savePhoto,
  type FuelDraft,
  type StoredPhoto,
} from '@/lib/offline'

const STEPS = ['Ticket', 'Datos', 'Confirmar']

function emptyDraft(vehicleId: string | null): FuelDraft {
  return {
    clientUuid: newClientUuid(),
    kind: 'fuel',
    step: 0,
    vehicleId,
    loadedOn: todayISO(),
    stationName: null,
    liters: null,
    pricePerLiter: null,
    totalAmount: null,
    odometer: null,
    folio: null,
    lat: null,
    lng: null,
    updatedAt: Date.now(),
  }
}

export function FuelWizard() {
  const navigate = useNavigate()
  const { unidad, chofer } = useAuth()
  const { sync, refreshPending, online, pending } = useSync()

  const [started, setStarted] = useState(false)
  const [draft, setDraft] = useState<FuelDraft | null>(null)
  const [ticket, setTicket] = useState<StoredPhoto | null>(null)
  const [stations, setStations] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Estaciones que este chofer ya usó: evita tipear la misma cada vez.
  useEffect(() => {
    if (!chofer) return
    void supabase
      .from('cargas_combustible')
      .select('estacion')
      .eq('chofer_id', chofer.id)
      .not('estacion', 'is', null)
      .order('fecha', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        const unique = [...new Set((data ?? []).map((row) => row.estacion).filter(Boolean))]
        setStations(unique as string[])
      })
  }, [chofer])

  const patch = useCallback((changes: Partial<FuelDraft>) => {
    setDraft((current) => {
      if (!current) return current
      const next = { ...current, ...changes, updatedAt: Date.now() }
      void saveDraft(next)
      return next
    })
  }, [])

  async function start() {
    const existing = await getActiveDraft('fuel')

    if (existing && existing.kind === 'fuel') {
      setDraft(existing)
      const photos = await getPhotos(existing.clientUuid)
      setTicket(photos.find((p) => p.slotCode === 'ticket') ?? null)
    } else {
      const fresh = emptyDraft(unidad?.id ?? null)
      const coords = await currentCoords(5000)
      fresh.lat = coords.lat
      fresh.lng = coords.lng
      await saveDraft(fresh)
      setDraft(fresh)
    }

    setStarted(true)
  }

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

  // ------------------------------------------------------------ portada
  if (!started) {
    return (
      <div className="min-h-dvh bg-surface-alt">
        <WizardHeader title="Carga de Combustible" onBack={() => navigate('/')} />

        <div className="p-4">
        <SectionTitle hint="Registra la carga de combustible de forma rápida.">
          Carga de Combustible
        </SectionTitle>

        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="fuel" size={38} />
          </span>
          <p className="text-sm text-body-soft">Tres pasos: ticket, datos y confirmación.</p>
        </Card>

        <ul className="mt-4 space-y-2.5">
          {[
            'Tené a mano el ticket de compra',
            'Tomá una foto clara del ticket',
            'Completá los datos y guardá el registro',
          ].map((tip) => (
            <li key={tip} className="flex items-center gap-2.5 text-sm text-body">
              <Icon name="checkCircle" size={17} className="shrink-0 text-brand-500" />
              {tip}
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <Button onClick={() => void start()}>Nueva Carga</Button>
        </div>
        </div>
      </div>
    )
  }

  if (!draft) return <Spinner label="Preparando…" />

  // ------------------------------------------------------------ final
  if (done) {
    const queued = !online || pending > 0

    return (
      <div className="safe-top flex min-h-dvh flex-col justify-between p-4">
        <div className="space-y-4 pt-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-500 text-white">
              <Icon name="check" size={40} strokeWidth={2.5} />
            </span>
            <h1 className="text-[22px] font-extrabold text-ink">¡Carga registrada!</h1>
            <p className="max-w-xs text-sm text-body-soft">
              {queued
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
          <Button
            variant="secondary"
            onClick={() => {
              setDone(false)
              setStarted(false)
              setDraft(null)
              setTicket(null)
            }}
          >
            Nuevo registro
          </Button>
        </div>
      </div>
    )
  }

  const total =
    draft.liters != null && draft.pricePerLiter != null ? draft.liters * draft.pricePerLiter : null

  const dataComplete = draft.liters != null && draft.pricePerLiter != null && draft.liters > 0

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <WizardHeader title="Nueva Carga de Combustible" onBack={() => navigate('/')} />
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
              {stations.map((station) => (
                <option key={station} value={station} />
              ))}
            </datalist>

            <Field label="Litros cargados">
              <Input
                icon="droplet"
                suffix="Lts"
                type="text"
                inputMode="decimal"
                placeholder="40.00"
                value={draft.liters ?? ''}
                onChange={(event) => patch({ liters: parseNumber(event.target.value) })}
              />
            </Field>

            <Field label="Precio por litro">
              <Input
                icon="fuel"
                suffix="$ / L"
                type="text"
                inputMode="decimal"
                placeholder="6.890"
                value={draft.pricePerLiter ?? ''}
                onChange={(event) => patch({ pricePerLiter: parseNumber(event.target.value) })}
              />
            </Field>

            {/* El total se calcula: escribirlo a mano es una fuente de errores. */}
            <Field label="Total" hint="Se calcula con litros × precio por litro.">
              <Input readOnly suffix="$" value={total != null ? total.toFixed(2) : ''} />
            </Field>

            <Field label="Kilometraje (opcional)">
              <Input
                icon="gauge"
                suffix="km"
                type="text"
                inputMode="numeric"
                placeholder="45230"
                value={draft.odometer ?? ''}
                onChange={(event) => patch({ odometer: parseNumber(event.target.value) })}
              />
            </Field>
          </div>

          <Footer
            onNext={() => patch({ step: 2, totalAmount: total })}
            disabled={!dataComplete}
            hint={!dataComplete ? 'Completá litros y precio por litro' : undefined}
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

            <Card>
              <SummaryRow label="Unidad" value={unidadLabel(unidad)} />
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
