import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { Stepper } from '@/components/Stepper'
import { Button, Card, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { useCatalogos } from '@/lib/catalog'
import { currentCoords } from '@/lib/capture'
import { todayISO } from '@/lib/format'
import {
  deletePhoto,
  enqueue,
  getActiveDraft,
  getPhotos,
  newClientUuid,
  saveDraft,
  savePhoto,
  type ChecklistDraft,
  type StoredPhoto,
} from '@/lib/offline'
import { StepEntry } from './StepEntry'
import { StepConditions } from './StepConditions'
import { StepPhotos } from './StepPhotos'
import { StepExit } from './StepExit'
import { StepSummary } from './StepSummary'
import { StepSignature } from './StepSignature'
import { StepDone } from './StepDone'

const STEPS = ['Entrada', 'Condiciones', 'Fotos', 'Salida', 'Resumen', 'Firma', 'Listo']

function emptyDraft(vehicleId: string | null, depotId: string | null): ChecklistDraft {
  return {
    clientUuid: newClientUuid(),
    kind: 'checklist',
    step: 0,
    vehicleId,
    depotId,
    checklistDate: todayISO(),
    entryAt: new Date().toISOString(),
    odometerStart: null,
    entryLat: null,
    entryLng: null,
    exitAt: null,
    odometerEnd: null,
    exitLat: null,
    exitLng: null,
    shiftLabel: null,
    observations: null,
    items: {},
    signature: null,
    signedAt: null,
    updatedAt: Date.now(),
  }
}

export function ChecklistWizard() {
  const navigate = useNavigate()
  const { unidad, chofer } = useAuth()
  const { sync, refreshPending } = useSync()
  const { catalogos, loading: catalogosLoading } = useCatalogos(chofer?.empresa_id ?? null)

  const [draft, setDraft] = useState<ChecklistDraft | null>(null)
  const [photos, setPhotos] = useState<StoredPhoto[]>([])
  const [submitting, setSubmitting] = useState(false)

  // ------------------------------------------------ cargar o crear borrador
  useEffect(() => {
    async function boot() {
      const existing = await getActiveDraft('checklist')

      if (existing && existing.kind === 'checklist') {
        setDraft(existing)
        setPhotos(await getPhotos(existing.clientUuid))
        return
      }

      const fresh = emptyDraft(unidad?.id ?? null, unidad?.bodega_id ?? null)
      const coords = await currentCoords()
      fresh.entryLat = coords.lat
      fresh.entryLng = coords.lng

      await saveDraft(fresh)
      setDraft(fresh)
    }

    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = useCallback(
    (changes: Partial<ChecklistDraft>) => {
      setDraft((current) => {
        if (!current) return current
        const next = { ...current, ...changes, updatedAt: Date.now() }
        void saveDraft(next)
        return next
      })
    },
    [],
  )

  const capturePhoto = useCallback(
    async (slotCode: string, label: string, blob: Blob) => {
      if (!draft) return
      const coords = await currentCoords(4000)

      const photo: StoredPhoto = {
        key: `${draft.clientUuid}:${slotCode}`,
        clientUuid: draft.clientUuid,
        slotCode,
        label,
        blob,
        takenAt: new Date().toISOString(),
        lat: coords.lat,
        lng: coords.lng,
      }

      await savePhoto(photo)
      setPhotos(await getPhotos(draft.clientUuid))
    },
    [draft],
  )

  const clearPhoto = useCallback(
    async (slotCode: string) => {
      if (!draft) return
      await deletePhoto(`${draft.clientUuid}:${slotCode}`)
      setPhotos(await getPhotos(draft.clientUuid))
    },
    [draft],
  )

  // ------------------------------------------------------------- envío
  async function submit() {
    if (!draft) return
    setSubmitting(true)
    try {
      await enqueue(draft.clientUuid, 'checklist')
      await refreshPending()
      patch({ step: 6 })
      // Si hay señal sube ahora; si no, queda en la cola y sale solo al reconectar.
      void sync()
    } finally {
      setSubmitting(false)
    }
  }

  if (catalogosLoading || !draft) return <Spinner label="Preparando el check list…" />

  if (!catalogos || catalogos.items.length === 0) {
    return (
      <div className="p-4">
        <WizardHeader title="Check List" onBack={() => navigate('/')} />
        <Card className="mt-4">
          <div className="flex gap-3">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-accent-600" />
            <div>
              <p className="font-semibold text-ink">Falta configurar el catálogo</p>
              <p className="mt-1 text-sm text-body-soft">
                No hay ítems de condiciones cargados para tu empresa. Pedile a un administrador
                que los dé de alta antes de usar el check list.
              </p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const step = draft.step
  const photoByCode = new Map(photos.map((photo) => [photo.slotCode, photo]))

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      {step < 6 && (
        <>
          <WizardHeader title="Check List" onBack={() => navigate('/')} />
          <Stepper steps={STEPS} current={step} onSelect={(index) => patch({ step: index })} />
        </>
      )}

      <div className="flex-1">
        {step === 0 && <StepEntry draft={draft} patch={patch} onNext={() => patch({ step: 1 })} />}

        {step === 1 && (
          <StepConditions
            draft={draft}
            items={catalogos.items}
            patch={patch}
            onNext={() => patch({ step: 2 })}
          />
        )}

        {step === 2 && (
          <StepPhotos
            slots={catalogos.fotos}
            photoByCode={photoByCode}
            onCapture={capturePhoto}
            onClear={clearPhoto}
            onNext={() => patch({ step: 3 })}
          />
        )}

        {step === 3 && <StepExit draft={draft} patch={patch} onNext={() => patch({ step: 4 })} />}

        {step === 4 && (
          <StepSummary
            draft={draft}
            items={catalogos.items}
            slots={catalogos.fotos}
            photoCount={photos.length}
            onNext={() => patch({ step: 5 })}
            onEdit={(index) => patch({ step: index })}
          />
        )}

        {step === 5 && (
          <StepSignature
            draft={draft}
            patch={patch}
            submitting={submitting}
            onSubmit={submit}
          />
        )}

        {step === 6 && <StepDone draft={draft} photoCount={photos.length} />}
      </div>
    </div>
  )
}

/** Barra de acción fija al pie, común a todos los pasos. */
export function WizardFooter({
  onNext,
  label = 'Siguiente',
  disabled,
  loading,
  hint,
  variant = 'primary',
}: {
  onNext: () => void
  label?: string
  disabled?: boolean
  loading?: boolean
  hint?: string
  variant?: 'primary' | 'success'
}) {
  return (
    <div className="safe-bottom sticky bottom-0 border-t border-gray-100 bg-white px-4 py-3">
      {hint && <p className="mb-2 text-center text-xs text-body-soft">{hint}</p>}
      <Button onClick={onNext} disabled={disabled} loading={loading} variant={variant}>
        {label}
      </Button>
    </div>
  )
}

export const CHECKLIST_STEPS = STEPS
