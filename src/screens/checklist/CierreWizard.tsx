import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { Stepper } from '@/components/Stepper'
import { Spinner } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { useTurno } from '@/context/TurnoContext'
import { useCatalogos } from '@/lib/catalog'
import { currentCoords } from '@/lib/capture'
import {
  deletePhoto,
  enqueue,
  getPhotos,
  saveDraft,
  savePhoto,
  type ChecklistDraft,
  type StoredPhoto,
} from '@/lib/offline'
import { StepExit } from './StepExit'
import { StepSummary } from './StepSummary'
import { StepSignature } from './StepSignature'
import { StepDone } from './StepDone'

const PASOS = ['Salida', 'Resumen', 'Firma']

export function CierreWizard() {
  const navigate = useNavigate()
  const { chofer } = useAuth()
  const { sync, refreshPending } = useSync()
  const { abierto, cargando: turnoCargando, draft: draftTurno, refrescar } = useTurno()
  const { catalogos, loading: catalogosLoading } = useCatalogos(chofer?.empresa_id ?? null)

  const [draft, setDraft] = useState<ChecklistDraft | null>(null)
  const [fotos, setFotos] = useState<StoredPhoto[]>([])
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  // El borrador viene del turno; sólo se copia al estado local la primera vez.
  const actual = draft ?? draftTurno
  const clientUuid = actual?.clientUuid

  // Las fotos de la apertura ya se borraron del teléfono al subirse, así que
  // acá sólo quedan las del cierre.
  useEffect(() => {
    if (!clientUuid) return
    void getPhotos(clientUuid).then(setFotos)
  }, [clientUuid])

  const capturarFoto = useCallback(
    async (codigo: string, etiqueta: string, blob: Blob) => {
      if (!clientUuid) return
      const coords = await currentCoords(4000)
      await savePhoto({
        key: `${clientUuid}:${codigo}`,
        clientUuid,
        slotCode: codigo,
        label: etiqueta,
        blob,
        takenAt: new Date().toISOString(),
        lat: coords.lat,
        lng: coords.lng,
      })
      setFotos(await getPhotos(clientUuid))
    },
    [clientUuid],
  )

  const quitarFoto = useCallback(
    async (codigo: string) => {
      if (!clientUuid) return
      await deletePhoto(`${clientUuid}:${codigo}`)
      setFotos(await getPhotos(clientUuid))
    },
    [clientUuid],
  )

  const patch = useCallback(
    (cambios: Partial<ChecklistDraft>) => {
      setDraft((previo) => {
        const base = previo ?? draftTurno
        if (!base) return previo
        const siguiente = { ...base, ...cambios, updatedAt: Date.now() }
        void saveDraft(siguiente)
        return siguiente
      })
    },
    [draftTurno],
  )

  async function enviar() {
    if (!actual) return
    setEnviando(true)
    try {
      await enqueue(actual.clientUuid, 'checklist_cierre')
      await refreshPending()
      setEnviado(true)
      void sync()
      await refrescar()
    } finally {
      setEnviando(false)
    }
  }

  if (turnoCargando || catalogosLoading) return <Spinner label="Cargando tu turno…" />

  // No se puede cerrar lo que no se abrió.
  if (!enviado && !abierto) return <Navigate to="/" replace />
  if (!actual) return <Spinner label="Cargando tu turno…" />

  if (enviado) return <StepDone draft={actual} fotos={0} modo="cierre" />

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <WizardHeader title="Cierre de Turno" onBack={() => navigate('/')} />
      <Stepper steps={PASOS} current={actual.step} onSelect={(i) => patch({ step: i })} />

      <div className="flex-1">
        {actual.step === 0 && (
          <StepExit
            draft={actual}
            patch={patch}
            onNext={() => patch({ step: 1 })}
            slots={catalogos?.fotosCierre ?? []}
            photoByCode={new Map(fotos.map((f) => [f.slotCode, f]))}
            onCapture={capturarFoto}
            onClear={quitarFoto}
          />
        )}

        {actual.step === 1 && (
          <StepSummary
            draft={actual}
            items={catalogos?.items ?? []}
            slots={catalogos?.fotosApertura ?? []}
            photoCount={catalogos?.fotosApertura.length ?? 0}
            onNext={() => patch({ step: 2 })}
            onEdit={(paso) => patch({ step: paso })}
          />
        )}

        {actual.step === 2 && (
          <StepSignature
            draft={actual}
            patch={patch}
            submitting={enviando}
            onSubmit={() => void enviar()}
          />
        )}
      </div>
    </div>
  )
}
