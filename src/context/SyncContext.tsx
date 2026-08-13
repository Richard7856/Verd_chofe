import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getOutbox } from '@/lib/offline'
import { flushOutbox } from '@/lib/sync'
import { useAuth } from './AuthContext'

/**
 * Sincronización automática. No hay botón de "sincronizar": el chofer no
 * tiene por qué saber que existe una cola. Se intenta solo al abrir la app,
 * al recuperar la conexión, cada vez que se encola algo, y periódicamente
 * mientras quede algo pendiente.
 */

const REINTENTO_MS = 30_000

interface SyncState {
  online: boolean
  pending: number
  syncing: boolean
  /** Registros que fallaron al enviarse; se siguen reintentando. */
  fallidos: number
  /** Motivo del último fallo, para poder decirle algo útil al chofer. */
  ultimoError: string | null
  /** Se llama al encolar algo, para que salga cuanto antes. */
  sync: () => Promise<void>
  refreshPending: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const { chofer } = useAuth()
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [fallidos, setFallidos] = useState(0)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const enCurso = useRef(false)

  const refreshPending = useCallback(async () => {
    const entradas = await getOutbox()
    setPending(entradas.filter((e) => e.status !== 'syncing').length)

    const conError = entradas.filter((e) => e.status === 'failed')
    setFallidos(conError.length)
    setUltimoError(conError.sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0]?.lastError ?? null)
  }, [])

  const sync = useCallback(async () => {
    // `enCurso` es una ref y no el estado: dos disparos casi simultáneos
    // (reconexión + intervalo) leerían el mismo `syncing` viejo y subirían
    // todo dos veces.
    if (!chofer || !navigator.onLine || enCurso.current) return

    enCurso.current = true
    setSyncing(true)
    try {
      await flushOutbox({ choferId: chofer.id, empresaId: chofer.empresa_id })
    } finally {
      enCurso.current = false
      setSyncing(false)
      await refreshPending()
    }
  }, [chofer, refreshPending])

  useEffect(() => {
    void refreshPending()
  }, [refreshPending])

  useEffect(() => {
    const alConectar = () => {
      setOnline(true)
      void sync()
    }
    const alDesconectar = () => setOnline(false)

    window.addEventListener('online', alConectar)
    window.addEventListener('offline', alDesconectar)
    return () => {
      window.removeEventListener('online', alConectar)
      window.removeEventListener('offline', alDesconectar)
    }
  }, [sync])

  // Al abrir la app con sesión y conexión, vaciar lo del turno anterior.
  useEffect(() => {
    if (chofer && online) void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chofer?.id, online])

  // Reintento periódico mientras quede algo en la cola. Se apaga solo cuando
  // no hay pendientes, para no despertar la radio del teléfono de balde.
  useEffect(() => {
    if (pending === 0 || !online || !chofer) return
    const id = setInterval(() => void sync(), REINTENTO_MS)
    return () => clearInterval(id)
  }, [pending, online, chofer, sync])

  const value = useMemo(
    () => ({ online, pending, syncing, fallidos, ultimoError, sync, refreshPending }),
    [online, pending, syncing, fallidos, ultimoError, sync, refreshPending],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const context = useContext(SyncContext)
  if (!context) throw new Error('useSync debe usarse dentro de SyncProvider')
  return context
}
