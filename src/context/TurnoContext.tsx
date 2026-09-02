import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabase'
import {
  descartarChecklist,
  getChecklistDraft,
  saveDraft,
  type ChecklistDraft,
} from '@/lib/offline'
import type { Unidad } from '@/lib/database.types'
import { useAuth } from './AuthContext'
import { useSync } from './SyncContext'

/**
 * El turno del chofer.
 *
 * La apertura del check list es lo que "abre" el turno y desbloquea la carga
 * de combustible y el cierre. Se considera abierto en dos casos:
 *
 *   1. Hay un borrador local en fase `cierre`. Pasa a esa fase en cuanto el
 *      chofer envía la apertura, incluso sin señal — si dependiéramos del
 *      servidor, el chofer se quedaría bloqueado justo cuando no hay datos,
 *      que es la situación normal en el patio.
 *   2. El servidor tiene un check list en `en_progreso`. Cubre el caso de
 *      cambiar de teléfono o reinstalar la app a media jornada.
 */

interface TurnoState {
  cargando: boolean
  abierto: boolean
  /** hay una apertura empezada pero todavía sin enviar */
  aperturaEnCurso: boolean
  draft: ChecklistDraft | null
  checklistId: string | null
  /**
   * Unidad con la que se abrió ESTE turno. No es lo mismo que la unidad
   * asignada al chofer: puede haberla cambiado después, y el turno tiene que
   * seguir mostrando con cuál salió.
   */
  unidadTurno: Unidad | null
  refrescar: () => Promise<void>
}

const TurnoContext = createContext<TurnoState | null>(null)

/**
 * ¿El servidor ya cerró este turno? Sin conexión no se puede saber, y ahí la
 * respuesta tiene que ser "no": dar por cerrado un turno por no tener señal
 * le borraría al chofer el trabajo del día.
 */
async function turnoYaCerrado(checklistId: string): Promise<boolean> {
  if (!navigator.onLine) return false

  const { data, error } = await supabase
    .from('checklists_unidad')
    .select('estado')
    .eq('id', checklistId)
    .maybeSingle()

  if (error || !data) return false
  return data.estado !== 'en_progreso'
}

export function TurnoProvider({ children }: { children: ReactNode }) {
  const { chofer } = useAuth()
  const { pending } = useSync()
  const [draft, setDraft] = useState<ChecklistDraft | null>(null)
  const [checklistId, setChecklistId] = useState<string | null>(null)
  const [unidadTurno, setUnidadTurno] = useState<Unidad | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargarUnidad = useCallback(async (unidadId: string | null) => {
    if (!unidadId) {
      setUnidadTurno(null)
      return
    }
    const { data } = await supabase.from('unidades').select('*').eq('id', unidadId).maybeSingle()
    setUnidadTurno(data ?? null)
  }, [])

  const refrescar = useCallback(async () => {
    if (!chofer) {
      setDraft(null)
      setChecklistId(null)
      setCargando(false)
      return
    }

    const local = await getChecklistDraft()
    if (local) {
      // El turno pudo cerrarse del lado del servidor mientras el borrador
      // seguía en el teléfono: a las 23:59 se cierran solos los que el chofer
      // no cerró. Si no se descarta acá, la app sigue creyendo que hay un
      // turno en curso y el chofer no puede abrir el de hoy.
      const cerradoEnServidor = local.remoteId ? await turnoYaCerrado(local.remoteId) : false

      if (!cerradoEnServidor) {
        setDraft(local)
        setChecklistId(local.remoteId)
        await cargarUnidad(local.vehicleId)
        setCargando(false)
        return
      }

      await descartarChecklist(local.clientUuid)
    }

    // Sin borrador local: puede haber un turno abierto en el servidor.
    const { data: abierto } = await supabase
      .from('checklists_unidad')
      .select('*')
      .eq('chofer_id', chofer.id)
      .eq('estado', 'en_progreso')
      .order('fecha', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!abierto) {
      setDraft(null)
      setChecklistId(null)
      setUnidadTurno(null)
      setCargando(false)
      return
    }

    // Se reconstruye el borrador para que el cierre pueda mostrar el resumen
    // de la apertura aunque este teléfono no la haya hecho.
    const { data: items } = await supabase
      .from('checklist_unidad_items')
      .select('codigo, etiqueta, estado, nota')
      .eq('checklist_id', abierto.id)

    const reconstruido: ChecklistDraft = {
      clientUuid: abierto.cliente_uuid,
      kind: 'checklist',
      fase: 'cierre',
      step: 0,
      remoteId: abierto.id,
      aperturaEnviada: true,
      vehicleId: abierto.unidad_id,
      depotId: abierto.bodega_id,
      checklistDate: abierto.fecha,
      entryAt: abierto.entrada_el,
      odometerStart: abierto.km_inicial,
      entryLat: abierto.entrada_lat,
      entryLng: abierto.entrada_lng,
      exitAt: null,
      odometerEnd: null,
      exitLat: null,
      exitLng: null,
      shiftLabel: abierto.ruta_turno,
      observations: abierto.observaciones,
      items: Object.fromEntries(
        (items ?? []).map((i) => [i.codigo, { status: i.estado, note: i.nota ?? undefined, label: i.etiqueta }]),
      ),
      signature: null,
      signedAt: null,
      updatedAt: Date.now(),
    }

    await saveDraft(reconstruido)
    setDraft(reconstruido)
    setChecklistId(abierto.id)
    await cargarUnidad(abierto.unidad_id)
    setCargando(false)
  }, [chofer, cargarUnidad])

  useEffect(() => {
    void refrescar()
  }, [refrescar])

  // Cuando la cola se vacía, la apertura ya subió y el borrador tiene remoteId.
  useEffect(() => {
    void refrescar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const value = useMemo<TurnoState>(
    () => ({
      cargando,
      abierto: draft?.fase === 'cierre',
      aperturaEnCurso: draft?.fase === 'apertura',
      draft,
      checklistId,
      unidadTurno,
      refrescar,
    }),
    [cargando, draft, checklistId, unidadTurno, refrescar],
  )

  return <TurnoContext.Provider value={value}>{children}</TurnoContext.Provider>
}

export function useTurno() {
  const context = useContext(TurnoContext)
  if (!context) throw new Error('useTurno debe usarse dentro de TurnoProvider')
  return context
}
