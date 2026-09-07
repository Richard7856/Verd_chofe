import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Input, Select, Spinner, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { CeldaFoto } from '../CeldaFoto'
import { km, liters, money, shortDate, todayISO } from '@/lib/format'
import {
  desvincularRuta,
  movimientosDelDia,
  revisarMovimiento,
  rutasTripDrive,
  turnosParaComparar,
  vincularRuta,
  vinculosDeRutas,
  type MovimientoDia,
  type RutaTripDrive,
  type VinculoRuta,
} from '../queries'

/** Un turno con más de esto (o negativo) es un dedazo en el odómetro. */
const KM_MAXIMO_CREIBLE = 1500

/** Diferencia contra el plan a partir de la cual hay que mirar el turno. */
const TOLERANCIA_KM = 20

/** Si no hay dato en la unidad, se asume esto. */
const RENDIMIENTO_POR_DEFECTO = 8

/**
 * Cuánto puede desviarse el consumo antes de marcarlo. Es ancho a propósito:
 * el chofer no carga exactamente lo que gastó —el tanque no se vacía cada
 * día—, así que el número de un solo día es indicativo. El rendimiento firme
 * sale del acumulado del periodo, en el reporte por chofer.
 */
const TOLERANCIA_LITROS = 0.4

type Turno = Awaited<ReturnType<typeof turnosParaComparar>>[number]

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

function kmDelTurno(t: Turno): number | null {
  if (t.km_inicial == null || t.km_final == null) return null
  const recorrido = t.km_final - t.km_inicial
  if (recorrido < 0 || recorrido > KM_MAXIMO_CREIBLE) return null
  return recorrido
}

const etiquetaRuta = (r: RutaTripDrive) => r.vehicle?.color ?? r.name

/**
 * La jornada completa de un día: kilómetros, ruta de TripDrive, consumo y el
 * gasto por aprobar. Todo junto porque son la misma decisión — si los km
 * cuadran con la ruta y el combustible cuadra con los km, el gasto se
 * aprueba; si no, se pregunta.
 *
 * Quien aprueba es una persona. Entre lo que rinde una camioneta en el papel
 * y lo que rinde cargada y en tráfico siempre hay diferencia, y ningún umbral
 * automático acierta: el panel marca lo que se sale de rango y el admin
 * resuelve.
 */
export function Kilometros() {
  const [fecha, setFecha] = useState(todayISO())
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [rutas, setRutas] = useState<RutaTripDrive[]>([])
  const [vinculos, setVinculos] = useState<VinculoRuta[]>([])
  const [movimientos, setMovimientos] = useState<MovimientoDia[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [avisoRutas, setAvisoRutas] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [eleccion, setEleccion] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    setAvisoRutas(null)
    try {
      const [t, v, m] = await Promise.all([
        turnosParaComparar(fecha, fecha),
        vinculosDeRutas(fecha, fecha),
        movimientosDelDia(fecha),
      ])
      setTurnos(t)
      setVinculos(v)
      setMovimientos(m)

      // TripDrive es de otro equipo: si su API está caída, el día se sigue
      // pudiendo revisar y aprobar. Sólo se pierde la comparación de km.
      try {
        setRutas(await rutasTripDrive(fecha, fecha))
      } catch (err) {
        setRutas([])
        setAvisoRutas(err instanceof Error ? err.message : 'TripDrive no respondió')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el día')
    } finally {
      setCargando(false)
    }
  }, [fecha])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vinculoPorTurno = useMemo(
    () => new Map(vinculos.map((v) => [v.checklist_id, v])),
    [vinculos],
  )
  const rutaPorId = useMemo(() => new Map(rutas.map((r) => [r.id, r])), [rutas])
  const rutasLibres = useMemo(() => {
    const tomadas = new Set(vinculos.map((v) => v.ruta_id))
    return rutas.filter((r) => !tomadas.has(r.id))
  }, [rutas, vinculos])

  /** Los movimientos de un turno: por check list, o por chofer si no lo trae. */
  const movimientosDe = useCallback(
    (t: Turno) =>
      movimientos.filter((m) =>
        m.checklist_id ? m.checklist_id === t.id : m.chofer_id === t.chofer_id,
      ),
    [movimientos],
  )

  const filas = useMemo(() => {
    return turnos.map((t) => {
      const v = vinculoPorTurno.get(t.id)
      const propios = kmDelTurno(t)
      const plan = v ? (rutaPorId.get(v.ruta_id)?.km_planned ?? v.km_planned ?? null) : null
      const movs = movimientosDe(t)

      const litros = movs.reduce((s, m) => s + (m.litros ?? 0), 0)
      const gasto = movs.reduce((s, m) => s + m.monto, 0)
      const esperado = t.unidad?.rendimiento_km_litro ?? RENDIMIENTO_POR_DEFECTO

      // Litros que esos kilómetros deberían haber costado.
      const litrosEsperados = propios != null ? propios / esperado : null
      const desvio =
        litrosEsperados != null && litrosEsperados > 0 && litros > 0
          ? litros / litrosEsperados - 1
          : null

      return {
        turno: t,
        vinculo: v ?? null,
        kmPropios: propios,
        kmPlan: plan,
        difKm: propios != null && plan != null ? propios - plan : null,
        movs,
        litros,
        gasto,
        esperado,
        litrosEsperados,
        desvio,
        pendientes: movs.filter((m) => m.estado_revision === 'pendiente').length,
      }
    })
  }, [turnos, vinculoPorTurno, rutaPorId, movimientosDe])

  const resumen = useMemo(() => {
    const conAmbos = filas.filter((f) => f.difKm != null)
    return {
      kmPropios: filas.reduce((s, f) => s + (f.kmPropios ?? 0), 0),
      kmPlan: conAmbos.reduce((s, f) => s + (f.kmPlan ?? 0), 0),
      kmPropiosComparables: conAmbos.reduce((s, f) => s + (f.kmPropios ?? 0), 0),
      litros: filas.reduce((s, f) => s + f.litros, 0),
      gasto: filas.reduce((s, f) => s + f.gasto, 0),
      pendientes: filas.reduce((s, f) => s + f.pendientes, 0),
      vinculados: filas.filter((f) => f.vinculo).length,
    }
  }, [filas])

  const difTotal = resumen.kmPropiosComparables - resumen.kmPlan

  async function conRecarga(clave: string, accion: () => Promise<void>) {
    setOcupado(clave)
    setError(null)
    try {
      await accion()
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la acción')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <>
      <PageTitle
        action={
          <div className="flex items-center gap-2">
            <Button block={false} variant="secondary" onClick={() => setFecha(sumarDias(fecha, -1))}>
              <Icon name="arrowLeft" size={16} />
            </Button>
            <div className="w-40">
              <Input
                type="date"
                icon="calendar"
                value={fecha}
                max={todayISO()}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <Button
              block={false}
              variant="secondary"
              disabled={fecha >= todayISO()}
              onClick={() => setFecha(sumarDias(fecha, 1))}
            >
              <Icon name="chevronRight" size={16} />
            </Button>
          </div>
        }
      >
        Revisión del día
      </PageTitle>

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-[--color-danger]">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {avisoRutas && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-2 text-[13px] text-accent-600">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          Sin datos de TripDrive: {avisoRutas} — el resto del día se puede revisar igual.
        </p>
      )}

      {cargando ? (
        <Spinner label="Cargando el día…" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-6">
            <Metric label="Turnos" value={turnos.length} />
            <Metric
              label="Con ruta"
              value={`${resumen.vinculados}/${turnos.length}`}
              tone={resumen.vinculados < turnos.length ? 'warn' : 'ok'}
            />
            <Metric label="Km del día" value={km(resumen.kmPropios)} />
            <Metric
              label="Vs. plan"
              value={`${difTotal >= 0 ? '+' : ''}${km(difTotal)}`}
              tone={Math.abs(difTotal) > TOLERANCIA_KM * 2 ? 'warn' : 'ok'}
              hint="sólo turnos con ruta"
            />
            <Metric label="Combustible" value={liters(resumen.litros)} />
            <Metric
              label="Por aprobar"
              value={resumen.pendientes}
              tone={resumen.pendientes > 0 ? 'warn' : 'ok'}
              hint={money(resumen.gasto)}
            />
          </div>

          <Panel title={`Jornada del ${shortDate(fecha)}`}>
            <Tabla
              columnas={['Chofer', 'Km', 'Ruta TripDrive', 'Dif.', 'Litros', 'Consumo', 'Gasto']}
              vacio="Nadie abrió turno este día."
            >
              {filas.map((f) => {
                const fueraKm = f.difKm != null && Math.abs(f.difKm) > TOLERANCIA_KM
                const fueraLitros = f.desvio != null && Math.abs(f.desvio) > TOLERANCIA_LITROS
                const t = f.turno

                return (
                  <tr key={t.id} className="align-top">
                    <Td>
                      <span className="font-medium text-ink">{t.chofer?.nombre ?? '—'}</span>
                      <span className="block font-mono text-[11px] text-body-soft">
                        {t.unidad?.placa ?? '—'}
                        {t.cierre_automatico && ' · cerrado por sistema'}
                      </span>
                    </Td>

                    <Td className="tabular-nums">
                      {f.kmPropios != null ? (
                        km(f.kmPropios)
                      ) : (
                        <span className="text-accent-600" title="Sin cerrar o km no creíble">
                          —
                        </span>
                      )}
                    </Td>

                    <Td className="min-w-[210px]">
                      {f.vinculo ? (
                        <span className="flex items-start gap-1.5">
                          <span className="text-body">
                            {f.vinculo.ruta_nombre ?? f.vinculo.ruta_id}
                            <span className="block text-[11px] text-body-soft">
                              {f.vinculo.ruta_placa ?? '—'}
                            </span>
                          </span>
                          <button
                            type="button"
                            disabled={ocupado === t.id}
                            onClick={() =>
                              void conRecarga(t.id, () => desvincularRuta(f.vinculo!.id))
                            }
                            title="Quitar el vínculo"
                            className="text-body-soft hover:text-[--color-danger] disabled:opacity-40"
                          >
                            <Icon name="x" size={13} />
                          </button>
                        </span>
                      ) : rutasLibres.length === 0 ? (
                        <span className="text-[11px] text-body-soft">sin rutas libres</span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Select
                            value={eleccion[t.id] ?? ''}
                            onChange={(v) => setEleccion((e) => ({ ...e, [t.id]: v }))}
                            options={[
                              { value: '', label: 'Elegí ruta…' },
                              ...rutasLibres.map((r) => ({
                                value: r.id,
                                label: `${etiquetaRuta(r)} · ${r.vehicle?.plate ?? '—'} · ${
                                  r.km_planned ?? '?'
                                } km`,
                              })),
                            ]}
                          />
                          <button
                            type="button"
                            disabled={!eleccion[t.id] || ocupado === t.id}
                            onClick={() => {
                              const r = rutaPorId.get(eleccion[t.id])
                              if (!r) return
                              void conRecarga(t.id, async () => {
                                await vincularRuta({ id: t.id, empresa_id: t.empresa_id }, r)
                                setEleccion((e) => ({ ...e, [t.id]: '' }))
                              })
                            }}
                            className="shrink-0 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-40"
                          >
                            Atar
                          </button>
                        </span>
                      )}
                    </Td>

                    <Td
                      className={cx('tabular-nums', fueraKm && 'font-semibold text-accent-600')}
                    >
                      {f.difKm != null ? `${f.difKm >= 0 ? '+' : ''}${km(f.difKm)}` : '—'}
                      {fueraKm && ' ⚠'}
                    </Td>

                    <Td className="tabular-nums">{f.litros > 0 ? liters(f.litros) : '—'}</Td>

                    {/* Lo cargado contra lo que esos km debían costar. */}
                    <Td className={cx('tabular-nums', fueraLitros && 'text-accent-600')}>
                      {f.litrosEsperados != null && f.litros > 0 ? (
                        <span
                          title={`Esperado ${f.litrosEsperados.toFixed(1)} L a ${f.esperado} km/L`}
                        >
                          {f.desvio! >= 0 ? '+' : ''}
                          {Math.round(f.desvio! * 100)}%{fueraLitros && ' ⚠'}
                        </span>
                      ) : (
                        <span className="text-body-soft">—</span>
                      )}
                    </Td>

                    <Td className="min-w-[230px]">
                      {f.movs.length === 0 ? (
                        <span className="text-[11px] text-body-soft">sin gastos</span>
                      ) : (
                        <ul className="space-y-1">
                          {f.movs.map((m) => (
                            <li key={m.id} className="flex items-center gap-1.5">
                              <CeldaFoto url={m.ticket_url} titulo={m.etiqueta} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] text-ink">
                                  {money(m.monto)}
                                  {m.litros ? ` · ${liters(m.litros)}` : ''}
                                </span>
                                <span className="block truncate text-[11px] text-body-soft">
                                  {m.etiqueta}
                                </span>
                              </span>

                              {m.estado_revision === 'pendiente' ? (
                                <span className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    disabled={ocupado === m.id}
                                    onClick={() =>
                                      void conRecarga(m.id, () =>
                                        revisarMovimiento(
                                          m.tipo === 'combustible'
                                            ? 'cargas_combustible'
                                            : 'gastos_chofer',
                                          m.id,
                                          'aprobado',
                                        ),
                                      )
                                    }
                                    title="Aprobar"
                                    className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-100 disabled:opacity-40"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    disabled={ocupado === m.id}
                                    onClick={() => {
                                      const nota = window.prompt(
                                        `¿Por qué se rechaza este gasto de ${money(m.monto)}?`,
                                      )
                                      if (nota == null) return
                                      void conRecarga(m.id, () =>
                                        revisarMovimiento(
                                          m.tipo === 'combustible'
                                            ? 'cargas_combustible'
                                            : 'gastos_chofer',
                                          m.id,
                                          'rechazado',
                                          nota,
                                        ),
                                      )
                                    }}
                                    title="Rechazar"
                                    className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-[--color-danger] hover:bg-red-100 disabled:opacity-40"
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={ocupado === m.id}
                                  onClick={() =>
                                    void conRecarga(m.id, () =>
                                      revisarMovimiento(
                                        m.tipo === 'combustible'
                                          ? 'cargas_combustible'
                                          : 'gastos_chofer',
                                        m.id,
                                        'pendiente',
                                      ),
                                    )
                                  }
                                  title="Volver a dejarlo pendiente"
                                  className="shrink-0 disabled:opacity-40"
                                >
                                  <Badge
                                    tone={m.estado_revision === 'aprobado' ? 'success' : 'danger'}
                                  >
                                    {m.estado_revision === 'aprobado' ? 'OK' : 'Rech.'}
                                  </Badge>
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </Tabla>
          </Panel>

          {rutasLibres.length > 0 && (
            <Panel title={`Rutas de TripDrive sin atar (${rutasLibres.length})`}>
              <Tabla columnas={['Ruta', 'Chofer', 'Unidad', 'Paradas', 'Km plan']}>
                {rutasLibres.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-body">{etiquetaRuta(r)}</Td>
                    <Td className="text-ink">{r.driver?.name ?? '—'}</Td>
                    <Td className="font-mono">{r.vehicle?.plate ?? '—'}</Td>
                    <Td className="tabular-nums">{r.stops}</Td>
                    <Td className="tabular-nums">{r.km_planned != null ? km(r.km_planned) : '—'}</Td>
                  </tr>
                ))}
              </Tabla>
            </Panel>
          )}
        </div>
      )}
    </>
  )
}
