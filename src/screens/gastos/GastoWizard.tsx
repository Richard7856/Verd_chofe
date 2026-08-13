import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { Stepper } from '@/components/Stepper'
import { PhotoSlot } from '@/components/PhotoSlot'
import { BlobImage } from '@/components/BlobImage'
import { NumberField } from '@/components/NumberField'
import { Button, Card, Field, Input, SectionTitle, Spinner, TextArea, cx } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { useTurno } from '@/context/TurnoContext'
import { currentCoords } from '@/lib/capture'
import { money, shortDate, todayISO, unidadLabel } from '@/lib/format'
import {
  deletePhoto,
  enqueue,
  getActiveDraft,
  getPhotos,
  newClientUuid,
  saveDraft,
  savePhoto,
  type GastoDraft,
  type StoredPhoto,
} from '@/lib/offline'
import type { TipoGasto } from '@/lib/database.types'

const PASOS = ['Tipo', 'Datos', 'Confirmar']

const TIPOS: Array<{ value: TipoGasto; label: string; detalle: string; icon: IconName }> = [
  { value: 'aceite', label: 'Aceite', detalle: 'Cambio o relleno', icon: 'droplet' },
  { value: 'anticongelante', label: 'Anticongelante', detalle: 'Refrigerante', icon: 'droplet' },
  { value: 'ponchadura', label: 'Ponchadura', detalle: 'Reparación de llanta', icon: 'disc' },
  { value: 'otro', label: 'Otro', detalle: 'Cualquier otro gasto', icon: 'plus' },
]

function borradorVacio(unidadId: string | null, checklistId: string | null): GastoDraft {
  return {
    clientUuid: newClientUuid(),
    kind: 'gasto',
    step: 0,
    vehicleId: unidadId,
    checklistId,
    fecha: todayISO(),
    tipo: 'aceite',
    descripcion: null,
    monto: null,
    lugar: null,
    folio: null,
    km: null,
    lat: null,
    lng: null,
    updatedAt: Date.now(),
  }
}

export function GastoWizard() {
  const navigate = useNavigate()
  const { unidad } = useAuth()
  const { sync, refreshPending, online, pending, fallidos } = useSync()
  const { abierto, cargando: turnoCargando, checklistId, unidadTurno, draft: turno } = useTurno()

  // La unidad sale del turno abierto, NO de la asignación del chofer: esa
  // puede estar vacía y el gasto moriría al enviarse, igual que pasó con los
  // check lists. El turno siempre tiene unidad porque es obligatoria al abrirlo.
  const unidadDelTurno = turno?.vehicleId ?? unidadTurno?.id ?? unidad?.id ?? null

  const [draft, setDraft] = useState<GastoDraft | null>(null)
  const [ticket, setTicket] = useState<StoredPhoto | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    async function iniciar() {
      const existente = await getActiveDraft('gasto')
      if (existente?.kind === 'gasto') {
        setDraft(existente)
        setTicket((await getPhotos(existente.clientUuid)).find((p) => p.slotCode === 'ticket') ?? null)
        return
      }

      const nuevo = borradorVacio(unidadDelTurno, checklistId)
      const coords = await currentCoords(5000)
      nuevo.lat = coords.lat
      nuevo.lng = coords.lng
      await saveDraft(nuevo)
      setDraft(nuevo)
    }

    // Se espera a conocer la unidad antes de crear el borrador: crearlo con
    // unidad nula produce un gasto que nunca se puede enviar.
    if (abierto && unidadDelTurno) void iniciar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, unidadDelTurno])

  const patch = useCallback((cambios: Partial<GastoDraft>) => {
    setDraft((actual) => {
      if (!actual) return actual
      const siguiente = { ...actual, ...cambios, updatedAt: Date.now() }
      void saveDraft(siguiente)
      return siguiente
    })
  }, [])

  async function capturarTicket(blob: Blob) {
    if (!draft) return
    const coords = await currentCoords(4000)
    const foto: StoredPhoto = {
      key: `${draft.clientUuid}:ticket`,
      clientUuid: draft.clientUuid,
      slotCode: 'ticket',
      label: 'Ticket del gasto',
      blob,
      takenAt: new Date().toISOString(),
      lat: coords.lat,
      lng: coords.lng,
    }
    await savePhoto(foto)
    setTicket(foto)
  }

  async function enviar() {
    if (!draft) return
    setEnviando(true)
    try {
      await enqueue(draft.clientUuid, 'gasto')
      await refreshPending()
      setListo(true)
      void sync()
    } finally {
      setEnviando(false)
    }
  }

  // Igual que el combustible: el gasto se ata a un turno abierto, así se sabe
  // a qué jornada y a qué unidad corresponde.
  if (turnoCargando) return <Spinner label="Cargando tu turno…" />
  if (!abierto && !listo) return <Navigate to="/" replace />
  if (!draft) return <Spinner label="Preparando…" />

  // --------------------------------------------------------- final
  if (listo) {
    const estado = fallidos > 0 ? 'error' : !online ? 'sin_señal' : pending > 0 ? 'enviando' : 'enviado'
    const tipo = TIPOS.find((t) => t.value === draft.tipo)

    return (
      <div className="safe-top flex min-h-dvh flex-col justify-between p-4">
        <div className="space-y-4 pt-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-500 text-white">
              <Icon name="check" size={40} strokeWidth={2.5} />
            </span>
            <h1 className="text-[22px] font-extrabold text-ink">¡Gasto registrado!</h1>
            <p className="max-w-xs text-sm text-body-soft">
              {estado === 'error'
                ? 'Se guardó en tu teléfono, pero no se pudo enviar.'
                : estado === 'sin_señal'
                  ? 'Se guardó en tu teléfono y se envía solo en cuanto tengas señal.'
                  : estado === 'enviando'
                    ? 'Guardado. Enviando…'
                    : 'El gasto quedó registrado.'}
            </p>
          </div>

          <Card>
            <div className="divide-y divide-gray-100">
              <Fila label="Tipo" value={tipo?.label ?? draft.tipo} />
              {draft.descripcion && <Fila label="Detalle" value={draft.descripcion} />}
              <Fila label="Monto" value={money(draft.monto)} />
              <Fila label="Fecha" value={shortDate(draft.fecha)} />
              <Fila label="Unidad" value={unidadLabel(unidadTurno ?? unidad)} />
            </div>
          </Card>
        </div>

        <div className="safe-bottom space-y-2 pt-6">
          <Button onClick={() => navigate('/')}>Ir al inicio</Button>
          <Button variant="secondary" onClick={() => navigate('/registros')}>
            Ver mis registros
          </Button>
        </div>
      </div>
    )
  }

  const necesitaDetalle = draft.tipo === 'otro'
  const datosListos =
    draft.monto != null &&
    draft.monto > 0 &&
    (!necesitaDetalle || (draft.descripcion ?? '').trim().length >= 3)

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <WizardHeader title="Gasto extra" onBack={() => navigate('/')} />
      <Stepper steps={PASOS} current={draft.step} onSelect={(i) => patch({ step: i })} />

      {/* ------------------------------------------------- paso 1: tipo */}
      {draft.step === 0 && (
        <>
          <div className="flex-1 space-y-3 p-4">
            <SectionTitle hint="¿En qué gastaste?">Tipo de gasto</SectionTitle>

            <div className="space-y-2">
              {TIPOS.map((t) => {
                const elegido = draft.tipo === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => patch({ tipo: t.value })}
                    className={cx(
                      'flex w-full items-center gap-3.5 rounded-2xl border bg-white p-4 text-left transition-colors',
                      elegido ? 'border-brand-500 ring-1 ring-brand-500' : 'border-transparent shadow-sm',
                    )}
                  >
                    <span
                      className={cx(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                        elegido ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-500',
                      )}
                    >
                      <Icon name={elegido ? 'check' : t.icon} size={19} />
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold text-ink">{t.label}</span>
                      <span className="block text-sm text-body-soft">{t.detalle}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <Pie onNext={() => patch({ step: 1 })} />
        </>
      )}

      {/* ------------------------------------------------ paso 2: datos */}
      {draft.step === 1 && (
        <>
          <div className="flex-1 space-y-4 p-4">
            {necesitaDetalle && (
              <Field label="¿Qué fue?" hint="Obligatorio cuando el tipo es «Otro».">
                <TextArea
                  rows={2}
                  maxLength={300}
                  placeholder="Ej.: cambio de banda, casetas, lavado…"
                  value={draft.descripcion ?? ''}
                  onChange={(e) => patch({ descripcion: e.target.value || null })}
                />
              </Field>
            )}

            <Field label="Monto">
              <NumberField
                decimales
                icon="fuel"
                suffix="$"
                placeholder="350.00"
                value={draft.monto}
                onChange={(v) => patch({ monto: v })}
              />
            </Field>

            <Field label="Fecha">
              <Input
                icon="calendar"
                type="date"
                value={draft.fecha}
                max={todayISO()}
                onChange={(e) => patch({ fecha: e.target.value })}
              />
            </Field>

            <Field label="¿Dónde? (opcional)">
              <Input
                icon="mapPin"
                placeholder="Taller, refaccionaria, vulcanizadora…"
                value={draft.lugar ?? ''}
                onChange={(e) => patch({ lugar: e.target.value || null })}
              />
            </Field>

            <Field label="Kilometraje (opcional)">
              <NumberField
                icon="gauge"
                suffix="km"
                placeholder="45230"
                value={draft.km}
                onChange={(v) => patch({ km: v })}
              />
            </Field>

            {!necesitaDetalle && (
              <Field label="Nota (opcional)">
                <Input
                  placeholder="Algo que convenga aclarar"
                  value={draft.descripcion ?? ''}
                  onChange={(e) => patch({ descripcion: e.target.value || null })}
                />
              </Field>
            )}
          </div>

          <Pie
            onNext={() => patch({ step: 2 })}
            disabled={!datosListos}
            hint={
              !datosListos
                ? necesitaDetalle
                  ? 'Escribí qué fue el gasto y su monto'
                  : 'Ingresá el monto'
                : undefined
            }
          />
        </>
      )}

      {/* -------------------------------------------- paso 3: confirmar */}
      {draft.step === 2 && (
        <>
          <div className="flex-1 space-y-3 p-4">
            <SectionTitle hint="Sacale foto al ticket si lo tenés.">Confirmar gasto</SectionTitle>

            <div className="mx-auto max-w-[220px]">
              <PhotoSlot
                label="Ticket (opcional)"
                required={false}
                blob={ticket?.blob ?? null}
                onCapture={capturarTicket}
                onClear={async () => {
                  await deletePhoto(`${draft.clientUuid}:ticket`)
                  setTicket(null)
                }}
              />
            </div>

            <Card className="flex gap-3">
              <BlobImage
                blob={ticket?.blob ?? null}
                alt="Ticket"
                className="h-24 w-16 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1 divide-y divide-gray-100">
                <Fila label="Tipo" value={TIPOS.find((t) => t.value === draft.tipo)?.label ?? draft.tipo} />
                {draft.descripcion && <Fila label="Detalle" value={draft.descripcion} />}
                <Fila label="Monto" value={money(draft.monto)} />
                <Fila label="Fecha" value={shortDate(draft.fecha)} />
                {draft.lugar && <Fila label="Lugar" value={draft.lugar} />}
                <Fila label="Unidad" value={unidadLabel(unidadTurno ?? unidad)} />
              </div>
            </Card>
          </div>

          <div className="safe-bottom sticky bottom-0 space-y-2 border-t border-gray-100 bg-white px-4 py-3">
            <Button variant="secondary" onClick={() => patch({ step: 1 })}>
              Editar información
            </Button>
            <Button variant="success" loading={enviando} onClick={() => void enviar()}>
              Guardar gasto
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Fila({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="shrink-0 text-body-soft">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

function Pie({ onNext, disabled, hint }: { onNext: () => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="safe-bottom sticky bottom-0 border-t border-gray-100 bg-white px-4 py-3">
      {hint && <p className="mb-2 text-center text-xs text-body-soft">{hint}</p>}
      <Button onClick={onNext} disabled={disabled}>
        Siguiente
      </Button>
    </div>
  )
}
