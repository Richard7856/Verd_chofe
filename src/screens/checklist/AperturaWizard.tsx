import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { Stepper } from '@/components/Stepper'
import { Card, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { useTurno } from '@/context/TurnoContext'
import { useCatalogos } from '@/lib/catalog'
import { currentCoords } from '@/lib/capture'
import { todayISO } from '@/lib/format'
import {
  deletePhoto,
  enqueue,
  getChecklistDraft,
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
import { StepDone } from './StepDone'

const PASOS = ['Entrada', 'Condiciones', 'Fotos']

function borradorVacio(unidadId: string | null, bodegaId: string | null): ChecklistDraft {
  return {
    clientUuid: newClientUuid(),
    kind: 'checklist',
    fase: 'apertura',
    step: 0,
    remoteId: null,
    aperturaEnviada: false,
    vehicleId: unidadId,
    depotId: bodegaId,
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

export function AperturaWizard() {
  const navigate = useNavigate()
  const { unidad, chofer } = useAuth()
  const { sync, refreshPending } = useSync()
  const { abierto, cargando: turnoCargando, refrescar } = useTurno()
  const { catalogos, loading: catalogosLoading } = useCatalogos(chofer?.empresa_id ?? null)

  const [draft, setDraft] = useState<ChecklistDraft | null>(null)
  const [fotos, setFotos] = useState<StoredPhoto[]>([])
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  useEffect(() => {
    async function iniciar() {
      const existente = await getChecklistDraft()

      if (existente?.fase === 'apertura') {
        setDraft(existente)
        setFotos(await getPhotos(existente.clientUuid))
        return
      }
      if (existente) return // ya está en fase de cierre: lo maneja el <Navigate>

      const nuevo = borradorVacio(unidad?.id ?? null, unidad?.bodega_id ?? null)
      const coords = await currentCoords()
      nuevo.entryLat = coords.lat
      nuevo.entryLng = coords.lng

      await saveDraft(nuevo)
      setDraft(nuevo)
    }

    void iniciar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = useCallback((cambios: Partial<ChecklistDraft>) => {
    setDraft((actual) => {
      if (!actual) return actual
      const siguiente = { ...actual, ...cambios, updatedAt: Date.now() }
      void saveDraft(siguiente)
      return siguiente
    })
  }, [])

  const capturarFoto = useCallback(
    async (codigo: string, etiqueta: string, blob: Blob) => {
      if (!draft) return
      const coords = await currentCoords(4000)

      await savePhoto({
        key: `${draft.clientUuid}:${codigo}`,
        clientUuid: draft.clientUuid,
        slotCode: codigo,
        label: etiqueta,
        blob,
        takenAt: new Date().toISOString(),
        lat: coords.lat,
        lng: coords.lng,
      })
      setFotos(await getPhotos(draft.clientUuid))
    },
    [draft],
  )

  const quitarFoto = useCallback(
    async (codigo: string) => {
      if (!draft) return
      await deletePhoto(`${draft.clientUuid}:${codigo}`)
      setFotos(await getPhotos(draft.clientUuid))
    },
    [draft],
  )

  async function enviar() {
    if (!draft) return
    setEnviando(true)
    try {
      // Pasar a fase `cierre` es lo que abre el turno. Se hace antes de
      // sincronizar a propósito: el chofer queda desbloqueado al instante,
      // aunque esté sin señal en el patio.
      const abiertoDraft: ChecklistDraft = { ...draft, fase: 'cierre', step: 0 }
      await saveDraft(abiertoDraft)
      setDraft(abiertoDraft)

      await enqueue(draft.clientUuid, 'checklist_apertura')
      await refreshPending()
      await refrescar()

      setEnviado(true)
      void sync()
    } finally {
      setEnviando(false)
    }
  }

  // Ya hay un turno abierto y no venimos de enviarlo recién.
  if (!enviado && !turnoCargando && abierto) return <Navigate to="/" replace />

  if (catalogosLoading || turnoCargando || !draft) {
    return <Spinner label="Preparando el check list…" />
  }

  if (enviado) return <StepDone draft={draft} fotos={fotos.length} modo="apertura" />

  if (!catalogos || catalogos.items.length === 0) {
    return (
      <div>
        <WizardHeader title="Registro de Entrada" onBack={() => navigate('/')} />
        <Card className="m-4">
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

  const fotoPorCodigo = new Map(fotos.map((f) => [f.slotCode, f]))

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <WizardHeader title="Registro de Entrada" onBack={() => navigate('/')} />
      <Stepper steps={PASOS} current={draft.step} onSelect={(i) => patch({ step: i })} />

      <div className="flex-1">
        {draft.step === 0 && (
          <StepEntry draft={draft} patch={patch} onNext={() => patch({ step: 1 })} />
        )}

        {draft.step === 1 && (
          <StepConditions
            draft={draft}
            items={catalogos.items}
            patch={patch}
            onNext={() => patch({ step: 2 })}
          />
        )}

        {draft.step === 2 && (
          <StepPhotos
            slots={catalogos.fotosApertura}
            photoByCode={fotoPorCodigo}
            onCapture={capturarFoto}
            onClear={quitarFoto}
            onNext={() => void enviar()}
            labelFinal="Abrir turno"
            enviando={enviando}
          />
        )}
      </div>
    </div>
  )
}
