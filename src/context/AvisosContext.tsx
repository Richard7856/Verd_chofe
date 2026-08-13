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
import type { AvisoChofer } from '@/lib/database.types'
import { useAuth } from './AuthContext'

/**
 * Avisos del administrador y recordatorios automáticos.
 *
 * A diferencia de los check lists, los avisos NO se guardan offline: son
 * mensajes del servidor y sin conexión simplemente no hay nada nuevo que
 * mostrar. Se recargan al abrir la app y cada pocos minutos.
 */

const REFRESCO_MS = 5 * 60 * 1000

interface AvisosState {
  avisos: AvisoChofer[]
  sinLeer: number
  cargando: boolean
  marcarLeido: (id: string) => Promise<void>
  marcarTodosLeidos: () => Promise<void>
  refrescar: () => Promise<void>
}

const AvisosContext = createContext<AvisosState | null>(null)

export function AvisosProvider({ children }: { children: ReactNode }) {
  const { chofer } = useAuth()
  const [avisos, setAvisos] = useState<AvisoChofer[]>([])
  const [cargando, setCargando] = useState(true)

  const refrescar = useCallback(async () => {
    if (!chofer) {
      setAvisos([])
      setCargando(false)
      return
    }

    const { data } = await supabase
      .from('avisos_chofer')
      .select('*')
      .eq('chofer_id', chofer.id)
      .order('created_at', { ascending: false })
      .limit(50)

    setAvisos(data ?? [])
    setCargando(false)
  }, [chofer])

  useEffect(() => {
    void refrescar()
  }, [refrescar])

  useEffect(() => {
    if (!chofer) return
    const id = setInterval(() => void refrescar(), REFRESCO_MS)
    return () => clearInterval(id)
  }, [chofer, refrescar])

  const marcarLeido = useCallback(async (id: string) => {
    const ahora = new Date().toISOString()
    // Optimista: el chofer ve el punto desaparecer al instante y no espera al
    // servidor por algo que no cambia nada importante si falla.
    setAvisos((previos) =>
      previos.map((a) => (a.id === id && !a.leido_el ? { ...a, leido_el: ahora } : a)),
    )
    await supabase.from('avisos_chofer').update({ leido_el: ahora }).eq('id', id).is('leido_el', null)
  }, [])

  const marcarTodosLeidos = useCallback(async () => {
    if (!chofer) return
    const ahora = new Date().toISOString()
    setAvisos((previos) => previos.map((a) => (a.leido_el ? a : { ...a, leido_el: ahora })))
    await supabase
      .from('avisos_chofer')
      .update({ leido_el: ahora })
      .eq('chofer_id', chofer.id)
      .is('leido_el', null)
  }, [chofer])

  const value = useMemo<AvisosState>(
    () => ({
      avisos,
      sinLeer: avisos.filter((a) => !a.leido_el).length,
      cargando,
      marcarLeido,
      marcarTodosLeidos,
      refrescar,
    }),
    [avisos, cargando, marcarLeido, marcarTodosLeidos, refrescar],
  )

  return <AvisosContext.Provider value={value}>{children}</AvisosContext.Provider>
}

export function useAvisos() {
  const context = useContext(AvisosContext)
  if (!context) throw new Error('useAvisos debe usarse dentro de AvisosProvider')
  return context
}
