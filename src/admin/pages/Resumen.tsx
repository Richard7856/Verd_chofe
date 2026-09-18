import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Input, Spinner, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { clockTime, km as fmtKm, liters, money, shortDate, todayISO } from '@/lib/format'
import {
  contarSolicitudesPendientes,
  fallasRecientes,
  listarIncidencias,
  resumenGeneral,
  sinRegistrar,
  turnosDe,
  type FilaResumen,
  type IncidenciaAdmin,
  type ResumenRango,
  type TurnoAdmin,
} from '../queries'
import type { Chofer } from '@/lib/database.types'

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

const primeroDelMes = (fecha: string) => `${fecha.slice(0, 7)}-01`

type Preset = { label: string; desde: (hoy: string) => string; hasta: (hoy: string) => string }

const PRESETS: Preset[] = [
  { label: 'Hoy', desde: (h) => h, hasta: (h) => h },
  { label: '7 días', desde: (h) => sumarDias(h, -6), hasta: (h) => h },
  { label: '30 días', desde: (h) => sumarDias(h, -29), hasta: (h) => h },
  { label: 'Este mes', desde: primeroDelMes, hasta: (h) => h },
]

/**
 * La foto de la operación en el rango que se elija.
 *
 * Nació como el tablero del día y se quedó corto: para decidir hace falta ver
 * el periodo —cuánto se gastó, cuántos kilómetros costó y quién los hizo—, no
 * el día suelto. El detalle diario (quién no registró, los turnos uno por uno)
 * sigue apareciendo cuando el rango es de un solo día, que es cuando esa
 * pregunta tiene sentido.
 */
export function Resumen() {
  const hoy = todayISO()
  const [desde, setDesde] = useState(() => sumarDias(hoy, -6))
  const [hasta, setHasta] = useState(hoy)

  const [datos, setDatos] = useState<ResumenRango | null>(null)
  const [turnosDelDia, setTurnosDelDia] = useState<TurnoAdmin[]>([])
  const [faltantes, setFaltantes] = useState<Chofer[]>([])
  const [incidencias, setIncidencias] = useState<IncidenciaAdmin[]>([])
  const [porAutorizar, setPorAutorizar] = useState(0)
  const [fallas, setFallas] = useState<Awaited<ReturnType<typeof fallasRecientes>>>([])
  const [cargando, setCargando] = useState(true)

  const unSoloDia = desde === hasta

  useEffect(() => {
    let vigente = true
    setCargando(true)

    Promise.all([
      resumenGeneral(desde, hasta),
      sinRegistrar(hasta),
      listarIncidencias(true),
      fallasRecientes(desde),
      contarSolicitudesPendientes(),
      unSoloDia ? turnosDe(desde) : Promise.resolve([]),
    ]).then(([r, f, i, fa, s, t]) => {
      if (!vigente) return
      setDatos(r)
      setFaltantes(f)
      setIncidencias(i)
      setFallas(fa)
      setPorAutorizar(s)
      setTurnosDelDia(t)
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [desde, hasta, unSoloDia])

  function aplicar(p: Preset) {
    setDesde(p.desde(hoy))
    setHasta(p.hasta(hoy))
  }

  const activo = (p: Preset) => p.desde(hoy) === desde && p.hasta(hoy) === hasta

  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => aplicar(p)}
                className={cx(
                  'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  activo(p)
                    ? 'bg-brand-500 text-white'
                    : 'bg-white text-body-soft hover:text-ink border border-gray-200',
                )}
              >
                {p.label}
              </button>
            ))}
            <div className="w-36">
              <Input
                type="date"
                icon="calendar"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <span className="text-xs text-body-soft">a</span>
            <div className="w-36">
              <Input
                type="date"
                value={hasta}
                min={desde}
                max={hoy}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
          </div>
        }
      >
        Resumen
      </PageTitle>

      {cargando || !datos ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {/* ------------------------------------------------ lo importante */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Gasto total"
              value={money(datos.gastoTotal)}
              tone="warn"
              hint={`${money(datos.combustible)} combustible · ${money(datos.extras)} extras`}
            />
            <Metric
              label="Kilómetros"
              value={fmtKm(datos.km)}
              hint={
                datos.costoPorKm != null ? `${money(datos.costoPorKm)} por km` : 'sin recorrido'
              }
            />
            <Metric
              label="Combustible"
              value={liters(datos.litros)}
              hint={
                datos.rendimiento != null
                  ? `${datos.rendimiento.toFixed(1)} km/L en el periodo`
                  : 'sin cargas'
              }
            />
            <Metric
              label="Turnos"
              value={datos.turnos}
              hint={`${datos.choferesConTurno} chofer(es) · ${datos.turnosAbiertos} abierto(s)`}
            />
          </div>

          {/* ------------------------------------------------ lo que urge */}
          <div className="grid gap-3 sm:grid-cols-3">
            <AvisoRapido
              activo={porAutorizar > 0}
              icono="fuel"
              a="/admin/solicitudes"
              titulo={`${porAutorizar} solicitud(es) de carga sin contestar`}
              detalle="Hasta que alguien responda, ese chofer no puede cargar."
              ok="Ninguna carga esperando autorización"
            />
            <AvisoRapido
              activo={incidencias.length > 0}
              icono="alert"
              a="/admin/incidencias"
              titulo={`${incidencias.length} incidencia(s) abierta(s)`}
              detalle="Reportes de ruta o de unidad sin atender."
              ok="Sin incidencias abiertas"
            />
            <AvisoRapido
              activo={datos.cerradosPorSistema > 0}
              icono="clock"
              a="/admin/turnos"
              titulo={`${datos.cerradosPorSistema} turno(s) los cerró el sistema`}
              detalle="Nadie cerró la ruta antes de las 11:59 p.m.; quedaron sin km final ni firma."
              ok="Todos los turnos los cerró su chofer"
            />
          </div>

          {datos.kmDescartados > 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-orange-50 px-4 py-3 text-sm text-accent-600">
              <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
              {datos.kmDescartados} turno(s) tienen un recorrido imposible (negativo o de más de{' '}
              {fmtKm(1500)}) y quedaron fuera de los totales. Casi siempre es un dedazo en el
              odómetro: se corrigen desde Turnos.
            </p>
          )}

          {/* ------------------------------------------------ desglose */}
          <Panel
            title="Por chofer"
            action={
              <Link to="/admin/reporte" className="text-sm font-semibold text-brand-500">
                Reporte detallado
              </Link>
            }
          >
            <TablaDesglose filas={datos.porChofer} encabezado="Chofer" />
          </Panel>

          <Panel title="Por unidad">
            <TablaDesglose filas={datos.porUnidad} encabezado="Unidad" />
          </Panel>

          {/* ------------------------------------------------ el día */}
          {unSoloDia && (
            <>
              <Panel
                title={`Sin registrar el ${shortDate(hasta)}`}
                action={
                  <span className="text-sm text-body-soft">{faltantes.length} chofer(es)</span>
                }
              >
                {faltantes.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-brand-600">
                    <Icon name="checkCircle" size={17} />
                    Todos los choferes activos abrieron turno.
                  </p>
                ) : (
                  <Tabla columnas={['Chofer', 'Teléfono', 'Licencia']}>
                    {faltantes.map((c) => (
                      <tr key={c.id}>
                        <Td className="font-medium text-ink">{c.nombre}</Td>
                        <Td>{c.telefono || '—'}</Td>
                        <Td>{c.licencia_numero || '—'}</Td>
                      </tr>
                    ))}
                  </Tabla>
                )}
              </Panel>

              <Panel
                title={`Turnos del ${shortDate(hasta)}`}
                action={
                  <Link to="/admin/turnos" className="text-sm font-semibold text-brand-500">
                    Ver todos
                  </Link>
                }
              >
                <Tabla
                  columnas={['Chofer', 'Unidad', 'Entrada', 'Salida', 'Recorrido', 'Estado']}
                  vacio="Nadie abrió turno este día."
                >
                  {turnosDelDia.map((t) => {
                    const recorrido =
                      t.km_inicial != null && t.km_final != null ? t.km_final - t.km_inicial : null
                    return (
                      <tr key={t.id}>
                        <Td className="font-medium text-ink">{t.chofer?.nombre ?? '—'}</Td>
                        <Td>{t.unidad?.placa ?? '—'}</Td>
                        <Td className="tabular-nums">{clockTime(t.entrada_el)}</Td>
                        <Td className="tabular-nums">{clockTime(t.salida_el)}</Td>
                        <Td className="tabular-nums">
                          {recorrido != null ? fmtKm(recorrido) : '—'}
                        </Td>
                        <Td>
                          {t.cierre_automatico ? (
                            <Badge tone="danger">Cerrado por sistema</Badge>
                          ) : (
                            <Badge tone={t.estado === 'completado' ? 'success' : 'warn'}>
                              {t.estado === 'completado' ? 'Cerrado' : 'Abierto'}
                            </Badge>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </Tabla>
              </Panel>
            </>
          )}

          {!unSoloDia && faltantes.length > 0 && (
            <Panel title={`Sin registrar el ${shortDate(hasta)}`}>
              <p className="px-4 py-3 text-sm text-body">
                {faltantes.map((c) => c.nombre).join(', ')} no abrió turno el último día del rango.
              </p>
            </Panel>
          )}

          <Panel title={`Fallas reportadas desde el ${shortDate(desde)}`}>
            <Tabla
              columnas={['Fecha', 'Unidad', 'Punto', 'Detalle']}
              vacio="Ninguna unidad reportó fallas."
            >
              {fallas.map((f, i) => (
                <tr key={`${f.fecha}-${f.etiqueta}-${i}`}>
                  <Td className="whitespace-nowrap">{shortDate(f.fecha)}</Td>
                  <Td className="font-medium text-ink">{f.placa}</Td>
                  <Td>{f.etiqueta}</Td>
                  <Td className="text-body-soft">{f.nota || '—'}</Td>
                </tr>
              ))}
            </Tabla>
          </Panel>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- piezas

/**
 * Las tres cosas que dejan a alguien esperando. En verde cuando no hay nada
 * que hacer: el silencio también es información, y así se distingue de "no
 * cargó".
 */
function AvisoRapido({
  activo,
  icono,
  a,
  titulo,
  detalle,
  ok,
}: {
  activo: boolean
  icono: 'fuel' | 'alert' | 'clock'
  a: string
  titulo: string
  detalle: string
  ok: string
}) {
  if (!activo) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-body-soft">
        <Icon name="checkCircle" size={17} className="shrink-0 text-brand-500" />
        {ok}
      </div>
    )
  }

  return (
    <Link
      to={a}
      className="flex gap-2.5 rounded-xl border border-[--color-danger]/30 bg-red-50/70 px-4 py-3 transition-colors hover:bg-red-50"
    >
      <Icon name={icono} size={18} className="mt-0.5 shrink-0 text-[--color-danger]" />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[--color-danger]">{titulo}</span>
        <span className="mt-0.5 block text-xs text-body">{detalle}</span>
      </span>
    </Link>
  )
}

function TablaDesglose({ filas, encabezado }: { filas: FilaResumen[]; encabezado: string }) {
  const total = filas.reduce((s, f) => s + f.total, 0)

  return (
    <Tabla
      columnas={[encabezado, 'Turnos', 'Km', 'Litros', 'km/L', 'Combustible', 'Extras', 'Total']}
      vacio="Sin movimientos en el rango."
    >
      {filas.map((f) => (
        <tr key={f.clave}>
          <Td className="font-medium text-ink">{f.nombre}</Td>
          <Td className="tabular-nums">{f.turnos || '—'}</Td>
          <Td className="tabular-nums">{f.km > 0 ? fmtKm(f.km) : '—'}</Td>
          <Td className="tabular-nums">{f.litros > 0 ? liters(f.litros) : '—'}</Td>
          <Td className="tabular-nums">
            {f.rendimiento != null ? f.rendimiento.toFixed(1) : '—'}
          </Td>
          <Td className="tabular-nums">{f.combustible > 0 ? money(f.combustible) : '—'}</Td>
          <Td className="tabular-nums">{f.extras > 0 ? money(f.extras) : '—'}</Td>
          <Td className="font-semibold tabular-nums text-ink">{money(f.total)}</Td>
        </tr>
      ))}
      {filas.length > 1 && (
        <tr className="bg-gray-50">
          <Td className="font-bold text-ink">Total</Td>
          <Td colSpan={6}>{''}</Td>
          <Td className="font-bold tabular-nums text-ink">{money(total)}</Td>
        </tr>
      )}
    </Tabla>
  )
}
