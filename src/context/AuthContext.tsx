import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Chofer, Empresa, Profile, Unidad } from '@/lib/database.types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  chofer: Chofer | null
  empresa: Empresa | null
  unidad: Unidad | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  asignarUnidad: (unidadId: string) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [chofer, setChofer] = useState<Chofer | null>(null)
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [unidad, setUnidad] = useState<Unidad | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarUnidadAsignada = useCallback(async (choferId: string) => {
    const { data: asignacion } = await supabase
      .from('chofer_unidad_asignaciones')
      .select('unidad_id')
      .eq('chofer_id', choferId)
      .is('liberada_el', null)
      .maybeSingle()

    if (!asignacion) {
      setUnidad(null)
      return
    }

    const { data: unidadRow } = await supabase
      .from('unidades')
      .select('*')
      .eq('id', asignacion.unidad_id)
      .maybeSingle()

    setUnidad(unidadRow ?? null)
  }, [])

  const cargarContexto = useCallback(
    async (userId: string) => {
      setError(null)

      const { data: profileRow, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (profileError) throw profileError
      if (!profileRow) throw new Error('Tu usuario no tiene perfil en el sistema.')
      setProfile(profileRow)

      // Esta app es sólo para choferes. Sin registro en `choferes`, RLS no le
      // deja crear check lists, así que conviene decirlo de frente en vez de
      // mostrar pantallas vacías.
      const { data: choferRow, error: choferError } = await supabase
        .from('choferes')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (choferError) throw choferError
      if (!choferRow) {
        throw new Error(
          'Esta aplicación es para choferes. Tu usuario no está dado de alta como chofer.',
        )
      }
      if (!choferRow.activo) {
        throw new Error('Tu alta de chofer está desactivada. Consultá con tu supervisor.')
      }
      setChofer(choferRow)

      const { data: empresaRow } = await supabase
        .from('empresas')
        .select('*')
        .eq('id', choferRow.empresa_id)
        .maybeSingle()
      setEmpresa(empresaRow ?? null)

      await cargarUnidadAsignada(choferRow.id)
    },
    [cargarUnidadAsignada],
  )

  const bootstrap = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession)

      if (!nextSession?.user) {
        setProfile(null)
        setChofer(null)
        setEmpresa(null)
        setUnidad(null)
        setLoading(false)
        return
      }

      try {
        await cargarContexto(nextSession.user.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar tu perfil.')
      } finally {
        setLoading(false)
      }
    },
    [cargarContexto],
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => bootstrap(data.session))

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // onAuthStateChange también se dispara al refrescar el token; recargar
      // todo el contexto en cada refresh sería un ida y vuelta innecesario.
      setSession((current) => {
        if (current?.user.id === nextSession?.user?.id) return nextSession
        void bootstrap(nextSession)
        return nextSession
      })
    })

    return () => listener.subscription.unsubscribe()
  }, [bootstrap])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (signInError) {
      throw new Error(
        signInError.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : signInError.message,
      )
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const asignarUnidad = useCallback(
    async (unidadId: string) => {
      if (!chofer) return

      await supabase
        .from('chofer_unidad_asignaciones')
        .update({ liberada_el: new Date().toISOString() })
        .eq('chofer_id', chofer.id)
        .is('liberada_el', null)

      const { error: insertError } = await supabase.from('chofer_unidad_asignaciones').insert({
        empresa_id: chofer.empresa_id,
        chofer_id: chofer.id,
        unidad_id: unidadId,
      })
      if (insertError) throw insertError

      await cargarUnidadAsignada(chofer.id)
    },
    [chofer, cargarUnidadAsignada],
  )

  const refresh = useCallback(async () => {
    if (session?.user) await cargarContexto(session.user.id)
  }, [session, cargarContexto])

  const value = useMemo(
    () => ({
      session,
      profile,
      chofer,
      empresa,
      unidad,
      loading,
      error,
      signIn,
      signOut,
      asignarUnidad,
      refresh,
    }),
    [session, profile, chofer, empresa, unidad, loading, error, signIn, signOut, asignarUnidad, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
