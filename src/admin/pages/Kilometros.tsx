import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Input, Select, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { km, shortDate, todayISO } from '@/lib/format'
import {
  desvincularRuta,
  rutasTripDrive,
  turnosParaComparar,
  vincularRuta,
  vinculosDeRutas,
  type RutaTripDrive,
  type VinculoRuta,
} from '../queries'

/** Un turno con más de esto (o negativo) es un dedazo en el odómetro. */
const KM_MAXIMO_CREIBLE = 1500

/** A partir de acá la diferencia deja de ser redondeo y hay que mirarla. */
const TOLERANCIA_KM = 20

type Turno = Awaited<ReturnType<typeof turnosParaComparar>>[number]

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Km del turno, o null si el odómetro no da un número creíble. */
function kmDelTurno(t: Turno): number | null {
  if (t.km_inicial == null || t.km_final == null) return null
  const recorrido = t.km_final - t.km_inicial
  if (recorrido < 0 || recorrido > KM_MAXIMO_CREIBLE) return null
  return recorrido
}

/** Cómo se lee una ruta en un renglón: el color es lo que usa la operación. */
const etiquetaRuta = (r: RutaTripDrive) => r.vehicle?.color ?? r.name

/**
 * Kilómetros del chofer contra el plan de ruta de TripDrive, día por día.
 *
 * El cruce lo hace una persona: los dos sistemas se dieron de alta por
 * separado y no comparten identificadores —TripDrive dice VFR-002 y "Chofer
 * 1"; acá hay placas reales y nombres completos—, así que adivinarlo sólo
 * produciría emparejamientos falsos. Una vez atada, la ruta queda guardada y
 * no hay que volver a elegirla.
 *
 * Se compara contra `km_planned`, no contra `km_gps`: el GPS del teléfono
 * pierde tramos cuando la app deja de grabar y los infla cuando salta.
 */
export function Kilometros() {
  const [fecha, setFecha] = useState(todayISO())
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [rutas, setRutas] = useState<RutaTripDrive[]>([])
  const [vinculos, setVinculos] = useState<VinculoRuta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [eleccion, setEleccion] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [t, r, v] = await Promise.all([
        turnosParaComparar(fecha, fecha),
        rutasTripDrive(fecha, fecha),
        vinculosDeRutas(fecha, fecha),
      ])
      setTurnos(t)
      setRutas(r)
      setVinculos(v)
    } catch (err) {
      setTurnos([])
      setRutas([])
      setVinculos([])
      setError(err instanceof Error ? err.message : 'No se pudieron traer las rutas')
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
  const rutasTomadas = useMemo(() => new Set(vinculos.map((v) => v.ruta_id)), [vinculos])
  const rutasLibres = useMemo(
    () => rutas.filter((r) => !rutasTomadas.has(r.id)),
    [rutas, rutasTomadas],
  )

  /** Km del plan: el de la API si sigue ahí, si no el guardado al vincular. */
  function kmPlanDe(v: VinculoRuta): number | null {
    return rutaPorId.get(v.ruta_id)?.km_planned ?? v.km_planned ?? null
  }

  const resumen = useMemo(() => {
    let kmChofer = 0
    let kmPlan = 0
    let fuera = 0

    for (const t of turnos) {
      const v = vinculoPorTurno.get(t.id)
      const propio = kmDelTurno(t)
      const plan = v ? kmPlanDe(v) : null
      if (propio == null || plan == null) continue
      kmChofer += propio
      kmPlan += plan
      if (Math.abs(propio - plan) > TOLERANCIA_KM) fuera += 1
    }

    return { kmChofer, kmPlan, fuera, vinculados: vinculoPorTurno.size }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnos, vinculoPorTurno, rutaPorId])

  async function atar(turno: Turno) {
    const rutaId = eleccion[turno.id]
    const ruta = rutaId ? rutaPorId.get(rutaId) : null
    if (!ruta) return

    setOcupado(turno.id)
    setError(null)
    try {
      await vincularRuta({ id: turno.id, empresa_id: turno.empresa_id }, ruta)
      setEleccion((e) => ({ ...e, [turno.id]: '' }))
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo vincular la ruta')
    } finally {
      setOcupado(null)
    }
  }

  async function soltar(v: VinculoRuta) {
    setOcupado(v.checklist_id)
    setError(null)
    try {
      await desvincularRuta(v.id)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desvincular')
    } finally {
      setOcupado(null)
    }
  }

  const diferencia = resumen.kmChofer - resumen.kmPlan

  return (
    <>
      <PageTitle
        action={
          <div className="flex items-center gap-2">
            <Button block={false} variant="secondary" onClick={() => setFecha(sumarDias(fecha, -1))}>
              <Icon name="arrowLeft" size={16} />
            </Button>
            <div className="w-44">
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
        Km vs TripDrive
      </PageTitle>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {cargando ? (
        <Spinner label="Consultando TripDrive…" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric label="Turnos del día" value={turnos.length} />
            <Metric
              label="Vinculados"
              value={`${resumen.vinculados} / ${turnos.length}`}
              tone={resumen.vinculados < turnos.length ? 'warn' : 'ok'}
              hint={`${rutasLibres.length} ruta(s) sin usar`}
            />
            <Metric label="Km del chofer" value={km(resumen.kmChofer)} hint="odómetro declarado" />
            <Metric label="Km del plan" value={km(resumen.kmPlan)} hint="TripDrive" />
            <Metric
              label="Diferencia"
              value={`${diferencia >= 0 ? '+' : ''}${km(diferencia)}`}
              tone={resumen.fuera > 0 ? 'warn' : 'ok'}
              hint={`${resumen.fuera} fuera de ±${TOLERANCIA_KM} km`}
            />
          </div>

          <Panel title={`Turnos del ${shortDate(fecha)}`}>
            <Tabla
              columnas={['Chofer', 'Unidad', 'Km chofer', 'Ruta de TripDrive', 'Km plan', 'Diferencia', '']}
              vacio="Nadie abrió turno este día."
            >
              {turnos.map((t) => {
                const v = vinculoPorTurno.get(t.id)
                const propio = kmDelTurno(t)
                const plan = v ? kmPlanDe(v) : null
                const dif = propio != null && plan != null ? propio - plan : null
                const fuera = dif != null && Math.abs(dif) > TOLERANCIA_KM

                return (
                  <tr key={t.id}>
                    <Td className="font-medium text-ink">{t.chofer?.nombre ?? '—'}</Td>
                    <Td className="font-mono">{t.unidad?.placa ?? '—'}</Td>
                    <Td className="tabular-nums">
                      {propio != null ? (
                        km(propio)
                      ) : (
                        <span
                          className="text-accent-600"
                          title="Sin cerrar, o el odómetro no da un número creíble"
                        >
                          —
                        </span>
                      )}
                    </Td>

                    <Td className="min-w-[260px]">
                      {v ? (
                        <span className="text-body">
                          {v.ruta_nombre ?? v.ruta_id}
                          <span className="block text-xs text-body-soft">
                            {v.ruta_placa ?? '—'} · {v.ruta_chofer ?? 'sin chofer'}
                          </span>
                        </span>
                      ) : rutasLibres.length === 0 ? (
                        <Badge tone="neutral">Sin rutas libres</Badge>
                      ) : (
                        <Select
                          value={eleccion[t.id] ?? ''}
                          onChange={(valor) => setEleccion((e) => ({ ...e, [t.id]: valor }))}
                          options={[
                            { value: '', label: 'Elegí una ruta…' },
                            ...rutasLibres.map((r) => ({
                              value: r.id,
                              label: `${etiquetaRuta(r)} · ${r.vehicle?.plate ?? '—'} · ${
                                r.driver?.name ?? 'sin chofer'
                              } · ${r.km_planned ?? '?'} km`,
                            })),
                          ]}
                        />
                      )}
                    </Td>

                    <Td className="tabular-nums">{plan != null ? km(plan) : '—'}</Td>
                    <Td
                      className={fuera ? 'font-semibold tabular-nums text-accent-600' : 'tabular-nums'}
                    >
                      {dif != null ? `${dif >= 0 ? '+' : ''}${km(dif)}` : '—'}
                      {fuera && ' ⚠'}
                    </Td>

                    <Td className="text-right">
                      {v ? (
                        <button
                          type="button"
                          disabled={ocupado === t.id}
                          onClick={() => void soltar(v)}
                          className="whitespace-nowrap text-xs font-semibold text-body-soft hover:underline disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!eleccion[t.id] || ocupado === t.id}
                          onClick={() => void atar(t)}
                          className="whitespace-nowrap text-xs font-semibold text-brand-600 hover:underline disabled:opacity-40"
                        >
                          Vincular
                        </button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </Tabla>
          </Panel>

          {/* Lo que sobra de TripDrive: un día que nadie registró, una ruta de
              otra flota, o simplemente que falta atarla. */}
          <Panel title={`Rutas de TripDrive sin vincular (${rutasLibres.length})`}>
            <Tabla
              columnas={['Ruta', 'Chofer', 'Unidad', 'Paradas', 'Km plan']}
              vacio="Todas las rutas del día están vinculadas."
            >
              {rutasLibres.map((r) => (
                <tr key={r.id}>
                  <Td className="max-w-xs text-body">{etiquetaRuta(r)}</Td>
                  <Td className="font-medium text-ink">{r.driver?.name ?? '—'}</Td>
                  <Td className="font-mono">{r.vehicle?.plate ?? '—'}</Td>
                  <Td className="tabular-nums">{r.stops}</Td>
                  <Td className="tabular-nums">{r.km_planned != null ? km(r.km_planned) : '—'}</Td>
                </tr>
              ))}
            </Tabla>
          </Panel>
        </div>
      )}
    </>
  )
}
