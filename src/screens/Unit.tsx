import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Badge, Card, EmptyState, Spinner, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import type { EstadoUnidad, Unidad } from '@/lib/database.types'

const ESTADOS: Record<EstadoUnidad, { label: string; tone: 'success' | 'warn' | 'neutral' }> = {
  disponible: { label: 'Disponible', tone: 'success' },
  en_ruta: { label: 'En ruta', tone: 'warn' },
  mantenimiento: { label: 'Mantenimiento', tone: 'warn' },
  inactiva: { label: 'Inactiva', tone: 'neutral' },
}

export function Unit() {
  const { unidad, asignarUnidad } = useAuth()
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase
      .from('unidades')
      .select('*')
      .eq('activo', true)
      .order('placa')
      .then(({ data }) => {
        setUnidades(data ?? [])
        setLoading(false)
      })
  }, [])

  async function elegir(id: string) {
    setGuardando(id)
    setError(null)
    try {
      await asignarUnidad(id)
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes('duplicate')
          ? 'Esa unidad ya está tomada por otro chofer.'
          : 'No se pudo asignar la unidad. Revisá tu conexión.',
      )
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="p-4">
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Unidad</h1>
      <p className="mb-4 text-sm text-body-soft">
        Elegí la unidad con la que vas a trabajar este turno.
      </p>

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : unidades.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="car"
            title="No hay unidades dadas de alta"
            description="Pedile a un administrador que cargue las unidades de tu empresa."
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {unidades.map((item) => {
            const seleccionada = unidad?.id === item.id
            const estado = ESTADOS[item.estado]
            const nombre =
              [item.marca, item.modelo].filter(Boolean).join(' ') || item.alias || 'Unidad'

            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={guardando !== null}
                  onClick={() => void elegir(item.id)}
                  className={cx(
                    'w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-colors',
                    seleccionada ? 'border-brand-500 ring-1 ring-brand-500' : 'border-transparent',
                    guardando !== null && 'opacity-60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cx(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                        seleccionada ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-500',
                      )}
                    >
                      <Icon name={seleccionada ? 'check' : 'car'} size={19} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{nombre}</p>
                      <p className="text-sm text-body-soft">
                        {item.placa}
                        {item.anio ? ` · ${item.anio}` : ''}
                      </p>
                    </div>

                    <div className="shrink-0">
                      <Badge tone={estado.tone}>{estado.label}</Badge>
                    </div>
                  </div>

                  {seleccionada && (
                    <p className="mt-2 text-xs font-semibold text-brand-600">Unidad asignada</p>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
