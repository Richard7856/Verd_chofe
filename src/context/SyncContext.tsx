import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getPendingCount } from '@/lib/offline'
import { flushOutbox } from '@/lib/sync'
import { useAuth } from './AuthContext'

interface SyncState {
  online: boolean
  pending: number
  syncing: boolean
  refreshPending: () => Promise<void>
  sync: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const { chofer } = useAuth()
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshPending = useCallback(async () => {
    setPending(await getPendingCount())
  }, [])

  const sync = useCallback(async () => {
    if (!chofer || !navigator.onLine || syncing) return

    setSyncing(true)
    try {
      await flushOutbox({ choferId: chofer.id, empresaId: chofer.empresa_id })
    } finally {
      setSyncing(false)
      await refreshPending()
    }
  }, [chofer, syncing, refreshPending])

  useEffect(() => {
    void refreshPending()
  }, [refreshPending])

  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      void sync()
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [sync])

  // Al abrir la app con sesión y conexión, vaciar lo que quedó del turno anterior.
  useEffect(() => {
    if (chofer && online) void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chofer?.id, online])

  const value = useMemo(
    () => ({ online, pending, syncing, refreshPending, sync }),
    [online, pending, syncing, refreshPending, sync],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const context = useContext(SyncContext)
  if (!context) throw new Error('useSync debe usarse dentro de SyncProvider')
  return context
}
