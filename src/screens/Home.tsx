import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useTurno } from '@/context/TurnoContext'
import { supabase } from '@/lib/supabase'
import { Badge, Card, EmptyState, cx } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icons'
import { clockTime, km, shortDate, unidadLabel } from '@/lib/format'

interface RegistroReciente {
  id: string
  tipo: 'checklist' | 'carga'
  fecha: string
  hora: string | null
  titulo: string
}

/** Acceso grande y táctil; cuando está bloqueado explica por qué. */
function Accion({
  icon,
  titulo,
  detalle,
  onClick,
  bloqueado = false,
  destacado = false,
}: {
  icon: IconName
  titulo: string
  detalle: string
  onClick: () => void
  bloqueado?: boolean
  destacado?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={bloqueado}
      className={cx(
        'flex w-full items-center gap-3.5 rounded-2xl px-5 py-4 text-left transition-colors',
        bloqueado && 'cursor-not-allowed bg-gray-100 text-gray-400',
        !bloqueado && destacado && 'bg-brand-500 text-white shadow-sm active:bg-brand-600',
        !bloqueado && !destacado && 'bg-white text-ink shadow-sm active:bg-gray-50',
      )}
    >
      <span
        className={cx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
          bloqueado && 'bg-gray-200 text-gray-400',
          !bloqueado && destacado && 'bg-white/20 text-white',
          !bloqueado && !destacado && 'bg-brand-50 text-brand-500',
        )}
      >
        <Icon name={bloqueado ? 'lock' : icon} size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold">{titulo}</span>
        <span className={cx('block text-sm', destacado && !bloqueado ? 'opacity-85' : 'text-body-soft')}>
          {detalle}
        </span>
      </span>
    </button>
  )
}

export function Home() {
  const { profile, chofer, unidad } = useAuth()
  const { abierto, aperturaEnCurso, draft, unidadTurno } = useTurno()
  const navigate = useNavigate()
  const [recientes, setRecientes] = useState<RegistroReciente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!chofer) return

    async function cargar() {
      const [checklists, cargas] = await Promise.all([
        supabase
          .from('checklists_unidad')
          .select('id, fecha, entrada_el')
          .eq('chofer_id', chofer!.id)
          .eq('estado', 'completado')
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
          titulo: 'Turno completado',
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
  }, [chofer, abierto])

  const primerNombre = (chofer?.nombre || profile?.nombre || 'Chofer').split(' ')[0]

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">¡Hola, {primerNombre}! 👋</h1>
        <p className="text-sm text-body-soft">Operador</p>
      </div>

      {/* ------------------------------------------------ estado del turno */}
      {abierto ? (
        <Card className="border border-brand-200 bg-brand-50/60">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-brand-700">Turno abierto</p>
              <p className="text-sm text-body">
                Desde las {clockTime(draft?.entryAt)} · {unidadLabel(unidadTurno ?? unidad)}
              </p>
              {draft?.odometerStart != null && (
                <p className="text-xs text-body-soft">Km de entrada: {km(draft.odometerStart)}</p>
              )}
            </div>
          </div>
        </Card>
      ) : (
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
      )}

      {/* ---------------------------------------------------- acciones */}
      <div className="space-y-2.5">
        {!abierto && (
          <Accion
            icon="play"
            destacado
            titulo={aperturaEnCurso ? 'Continuar registro de entrada' : 'Registro de entrada'}
            detalle={
              aperturaEnCurso
                ? 'Lo dejaste sin terminar'
                : 'Entrada, condiciones y fotos de la unidad'
            }
            onClick={() => navigate('/checklist/apertura')}
          />
        )}

        <Accion
          icon="fuel"
          titulo="Carga de combustible"
          detalle={abierto ? 'Ticket, litros y precio' : 'Abrí tu turno para habilitarlo'}
          bloqueado={!abierto}
          onClick={() => navigate('/combustible')}
        />

        <Accion
          icon="flag"
          destacado={abierto}
          titulo="Cierre de turno"
          detalle={abierto ? 'Salida, resumen y firma' : 'Abrí tu turno para habilitarlo'}
          bloqueado={!abierto}
          onClick={() => navigate('/checklist/cierre')}
        />

        <Accion
          icon="alert"
          titulo="Reportar incidencia"
          detalle="Algo que tu supervisor deba saber"
          onClick={() => navigate('/incidencias')}
        />
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
              description="Cuando cierres tu primer turno va a aparecer acá."
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
