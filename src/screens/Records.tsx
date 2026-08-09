import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { supabase } from '@/lib/supabase'
import { Badge, Card, EmptyState, Spinner, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { clockTime, km, liters, money, shortDate } from '@/lib/format'
import { getOutbox, type OutboxEntry } from '@/lib/offline'

type Tab = 'checklist' | 'fuel'

interface FilaChecklist {
  id: string
  fecha: string
  entrada_el: string | null
  salida_el: string | null
  km_inicial: number | null
  km_final: number | null
  estado: string
  ruta_turno: string | null
}

interface FilaCarga {
  id: string
  fecha: string
  estacion: string | null
  litros: number
  precio_litro: number
  total: number
}

export function Records() {
  const { chofer } = useAuth()
  const { pending } = useSync()
  const [tab, setTab] = useState<Tab>('checklist')
  const [checklists, setChecklists] = useState<FilaChecklist[]>([])
  const [cargas, setCargas] = useState<FilaCarga[]>([])
  const [cola, setCola] = useState<OutboxEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void getOutbox().then(setCola)
  }, [pending])

  useEffect(() => {
    if (!chofer) return

    async function cargar() {
      const [checklistResult, cargaResult] = await Promise.all([
        supabase
          .from('checklists_unidad')
          .select('id, fecha, entrada_el, salida_el, km_inicial, km_final, estado, ruta_turno')
          .eq('chofer_id', chofer!.id)
          .order('fecha', { ascending: false })
          .limit(50),
        supabase
          .from('cargas_combustible')
          .select('id, fecha, estacion, litros, precio_litro, total')
          .eq('chofer_id', chofer!.id)
          .order('fecha', { ascending: false })
          .limit(50),
      ])

      setChecklists(checklistResult.data ?? [])
      setCargas(cargaResult.data ?? [])
      setLoading(false)
    }

    void cargar()
  }, [chofer, pending])

  const pendientesDeEsteTab = cola.filter((entry) => entry.kind === tab)

  return (
    <div className="p-4">
      <h1 className="mb-3 text-[22px] font-extrabold text-ink">Mis Registros</h1>

      <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
        {[
          { id: 'checklist' as const, label: 'Check List' },
          { id: 'fuel' as const, label: 'Combustible' },
        ].map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            onClick={() => setTab(opcion.id)}
            className={cx(
              'flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors',
              tab === opcion.id ? 'bg-white text-brand-600 shadow-sm' : 'text-body-soft',
            )}
          >
            {opcion.label}
          </button>
        ))}
      </div>

      {/* Lo que todavía no salió del teléfono va primero: es lo que preocupa. */}
      {pendientesDeEsteTab.length > 0 && (
        <ul className="mb-3 space-y-2">
          {pendientesDeEsteTab.map((entry) => (
            <li key={entry.clientUuid}>
              <Card className="flex items-center gap-3 border border-accent-400/40 bg-orange-50/50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-accent-600">
                  <Icon name={entry.status === 'failed' ? 'alert' : 'cloudOff'} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {entry.kind === 'fuel' ? 'Carga de combustible' : 'Check List'}
                  </p>
                  <p className="truncate text-xs text-body-soft">
                    {entry.status === 'failed'
                      ? `No se pudo enviar: ${entry.lastError ?? 'error desconocido'}`
                      : 'Guardado en el teléfono, esperando señal'}
                  </p>
                </div>
                <Badge tone="warn">Pendiente</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <Spinner />
      ) : tab === 'checklist' ? (
        checklists.length === 0 && pendientesDeEsteTab.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon="clipboard"
              title="Sin check lists"
              description="Los check lists que completes van a aparecer acá."
            />
          </Card>
        ) : (
          <ul className="space-y-2">
            {checklists.map((row) => {
              const recorrido =
                row.km_inicial != null && row.km_final != null ? row.km_final - row.km_inicial : null

              return (
                <li key={row.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{shortDate(row.fecha)}</p>
                        <p className="truncate text-xs text-body-soft">
                          {row.ruta_turno || 'Sin ruta indicada'}
                        </p>
                      </div>
                      <Badge tone={row.estado === 'completado' ? 'success' : 'warn'}>
                        {row.estado === 'completado' ? 'Completado' : 'En progreso'}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-body-soft">
                      <span>Entrada {clockTime(row.entrada_el)}</span>
                      <span>Salida {clockTime(row.salida_el)}</span>
                      {recorrido != null && <span>Recorrido {km(recorrido)}</span>}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )
      ) : cargas.length === 0 && pendientesDeEsteTab.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="fuel"
            title="Sin cargas registradas"
            description="Registrá tu primera carga de combustible desde el menú."
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {cargas.map((row) => (
            <li key={row.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{row.estacion || 'Estación'}</p>
                    <p className="text-xs text-body-soft">{shortDate(row.fecha)}</p>
                  </div>
                  <p className="shrink-0 font-bold text-brand-600">{money(row.total)}</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-body-soft">
                  <span>{liters(row.litros)}</span>
                  <span>{money(row.precio_litro)} / L</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
