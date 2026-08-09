import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { clockTime, shortDate, unidadLabel } from '@/lib/format'
import { getActiveDraft, type Draft } from '@/lib/offline'

interface RegistroReciente {
  id: string
  tipo: 'checklist' | 'carga'
  fecha: string
  hora: string | null
  titulo: string
}

export function Home() {
  const { profile, chofer, unidad } = useAuth()
  const navigate = useNavigate()
  const [recientes, setRecientes] = useState<RegistroReciente[]>([])
  const [borrador, setBorrador] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void getActiveDraft('checklist').then((found) => setBorrador(found ?? null))
  }, [])

  useEffect(() => {
    if (!chofer) return

    async function cargar() {
      const [checklists, cargas] = await Promise.all([
        supabase
          .from('checklists_unidad')
          .select('id, fecha, entrada_el')
          .eq('chofer_id', chofer!.id)
          .order('fecha', { ascending: false })
          .limit(5),
        supabase
          .from('cargas_combustible')
          .select('id, fecha, created_at')
          .eq('chofer_id', chofer!.id)
          .order('fecha', { ascending: false })
          .limit(5),
      ])

      const filas: RegistroReciente[] = [
        ...(checklists.data ?? []).map((row) => ({
          id: row.id,
          tipo: 'checklist' as const,
          fecha: row.fecha,
          hora: row.entrada_el,
          titulo: 'Check List',
        })),
        ...(cargas.data ?? []).map((row) => ({
          id: row.id,
          tipo: 'carga' as const,
          fecha: row.fecha,
          hora: row.created_at,
          titulo: 'Carga de Combustible',
        })),
      ]
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
        .slice(0, 4)

      setRecientes(filas)
      setLoading(false)
    }

    void cargar()
  }, [chofer])

  const primerNombre = (chofer?.nombre || profile?.nombre || 'Chofer').split(' ')[0]

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">¡Hola, {primerNombre}! 👋</h1>
        <p className="text-sm text-body-soft">Operador</p>
      </div>

      {/* --------------------------------------------- unidad asignada */}
      <Card>
        <p className="text-sm font-semibold text-brand-600">Unidad asignada</p>

        {unidad ? (
          <>
            <p className="mt-1 text-[17px] font-bold text-ink">{unidadLabel(unidad)}</p>
            <p className="text-sm text-body-soft">
              {unidad.anio ? `${unidad.anio} · ` : ''}
              {unidad.estado === 'disponible' ? 'Disponible' : unidad.estado.replace('_', ' ')}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-body-soft">
            Todavía no elegiste unidad para este turno.
          </p>
        )}

        <Link
          to="/unidad"
          className="mt-3 flex items-center justify-end gap-1 text-sm font-semibold text-brand-500"
        >
          {unidad ? 'Cambiar unidad' : 'Elegir unidad'}
          <Icon name="chevronRight" size={16} />
        </Link>
      </Card>

      {/* ------------------------------------------------- acción principal */}
      {borrador ? (
        <Card className="border border-accent-400/40 bg-orange-50/50">
          <div className="flex items-start gap-3">
            <Icon name="clipboard" size={20} className="mt-0.5 text-accent-600" />
            <div className="flex-1">
              <p className="font-semibold text-ink">Tenés un check list sin terminar</p>
              <p className="text-sm text-body-soft">
                Quedó en el paso {(borrador.step ?? 0) + 1}. Podés seguir donde lo dejaste.
              </p>
            </div>
          </div>
          <Button className="mt-3" onClick={() => navigate('/checklist')}>
            Continuar check list
          </Button>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/checklist')}
          className="w-full rounded-2xl bg-brand-500 px-5 py-4 text-left text-white shadow-sm active:bg-brand-600"
        >
          <span className="block text-[17px] font-bold">Iniciar Check List</span>
          <span className="block text-sm opacity-85">Registra entrada y condiciones</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/combustible"
          className="flex flex-col gap-1.5 rounded-2xl bg-white p-4 shadow-sm active:bg-gray-50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="fuel" size={18} />
          </span>
          <span className="text-sm font-semibold text-ink">Carga de combustible</span>
        </Link>

        <Link
          to="/incidencias"
          className="flex flex-col gap-1.5 rounded-2xl bg-white p-4 shadow-sm active:bg-gray-50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-50 text-accent-600">
            <Icon name="alert" size={18} />
          </span>
          <span className="text-sm font-semibold text-ink">Reportar incidencia</span>
        </Link>
      </div>

      {/* ---------------------------------------------------- recientes */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-ink">Registros recientes</h2>
          <Link to="/registros" className="text-sm font-semibold text-brand-500">
            Ver todos
          </Link>
        </div>

        {loading ? (
          <Card>
            <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
          </Card>
        ) : recientes.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon="clipboard"
              title="Todavía no hay registros"
              description="Cuando completes tu primer check list va a aparecer acá."
            />
          </Card>
        ) : (
          <ul className="space-y-2">
            {recientes.map((registro) => (
              <li key={`${registro.tipo}-${registro.id}`}>
                <Card className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                    <Icon name={registro.tipo === 'carga' ? 'fuel' : 'clipboard'} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{registro.titulo}</p>
                    <p className="text-xs text-body-soft">
                      {shortDate(registro.fecha)}
                      {registro.hora ? ` · ${clockTime(registro.hora)}` : ''}
                    </p>
                  </div>
                  <Badge tone="success">Completado</Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
