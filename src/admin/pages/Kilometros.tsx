import { useEffect, useMemo, useState } from 'react'
import { Badge, Input, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { km, shortDate, todayISO } from '@/lib/format'
import {
  rutasTripDrive,
  turnosParaComparar,
  type RutaTripDrive,
} from '../queries'

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/** Un turno con más de esto (o negativo) es un dedazo en el odómetro. */
const KM_MAXIMO_CREIBLE = 1500

/** A partir de acá la diferencia deja de ser redondeo y hay que mirarla. */
const TOLERANCIA_KM = 20

type Turno = Awaited<ReturnType<typeof turnosParaComparar>>[number]

/** Placas sin guiones ni espacios: cada sistema las escribe a su manera. */
const normalizarPlaca = (v: string | null | undefined) =>
  (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Nombres comparables: sin acentos, sin dobles espacios, en minúsculas. */
const palabrasDeNombre = (v: string | null | undefined) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 2)

/**
 * ¿La ruta y el turno son del mismo viaje?
 *
 * Primero por placa, que es lo único con forma de identificador. Si no
 * coinciden —los dos sistemas se dieron de alta por separado y nada garantiza
 * que escriban igual la placa— se cae al nombre del chofer: se aceptan dos
 * palabras en común para tolerar que uno guarde "Erick Paredes" y el otro el
 * nombre completo.
 */
function emparejan(turno: Turno, ruta: RutaTripDrive): boolean {
  if (turno.fecha !== ruta.date) return false

  const placaTurno = normalizarPlaca(turno.unidad?.placa)
  const placaRuta = normalizarPlaca(ruta.vehicle?.plate)
  if (placaTurno && placaRuta && placaTurno === placaRuta) return true

  const a = palabrasDeNombre(turno.chofer?.nombre)
  const b = palabrasDeNombre(ruta.driver?.name)
  const comunes = a.filter((p) => b.includes(p))
  return comunes.length >= 2
}

/** Km del turno, o null si el odómetro no da un número creíble. */
function kmDelTurno(t: Turno): number | null {
  if (t.km_inicial == null || t.km_final == null) return null
  const recorrido = t.km_final - t.km_inicial
  if (recorrido < 0 || recorrido > KM_MAXIMO_CREIBLE) return null
  return recorrido
}

interface Fila {
  turno: Turno
  ruta: RutaTripDrive | null
  kmNuestro: number | null
  kmPlan: number | null
  diferencia: number | null
}

/**
 * Compara los kilómetros que declara el chofer contra los que TripDrive
 * planeó para su ruta del día.
 *
 * Se compara contra `km_planned` y no contra `km_gps`: el GPS del teléfono
 * pierde tramos cuando la app deja de grabar y los infla cuando salta, así que
 * como vara de medir no sirve. El de GPS se muestra sólo de referencia y sólo
 * cuando TripDrive lo marca confiable.
 */
export function Kilometros() {
  const [desde, setDesde] = useState(haceDias(7))
  const [hasta, setHasta] = useState(todayISO())
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [rutas, setRutas] = useState<RutaTripDrive[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)

    Promise.all([turnosParaComparar(desde, hasta), rutasTripDrive(desde, hasta)])
      .then(([t, r]) => {
        if (!vigente) return
        setTurnos(t)
        setRutas(r)
      })
      .catch((err) => {
        if (!vigente) return
        setTurnos([])
        setRutas([])
        setError(err instanceof Error ? err.message : 'No se pudieron traer las rutas')
      })
      .finally(() => vigente && setCargando(false))

    return () => {
      vigente = false
    }
  }, [desde, hasta])

  const { filas, rutasSueltas, resumen } = useMemo(() => {
    const usadas = new Set<string>()

    const filas: Fila[] = turnos.map((turno) => {
      const ruta = rutas.find((r) => !usadas.has(r.id) && emparejan(turno, r)) ?? null
      if (ruta) usadas.add(ruta.id)

      const kmNuestro = kmDelTurno(turno)
      const kmPlan = ruta?.km_planned ?? null
      return {
        turno,
        ruta,
        kmNuestro,
        kmPlan,
        diferencia: kmNuestro != null && kmPlan != null ? kmNuestro - kmPlan : null,
      }
    })

    const comparables = filas.filter((f) => f.diferencia != null)
    const resumen = {
      emparejados: filas.filter((f) => f.ruta).length,
      comparables: comparables.length,
      kmNuestro: comparables.reduce((s, f) => s + (f.kmNuestro ?? 0), 0),
      kmPlan: comparables.reduce((s, f) => s + (f.kmPlan ?? 0), 0),
      fueraDeTolerancia: comparables.filter((f) => Math.abs(f.diferencia!) > TOLERANCIA_KM).length,
    }

    return {
      filas,
      rutasSueltas: rutas.filter((r) => !usadas.has(r.id)),
      resumen,
    }
  }, [turnos, rutas])

  const diferenciaTotal = resumen.kmNuestro - resumen.kmPlan

  return (
    <>
      <PageTitle
        action={
          <div className="flex items-center gap-2">
            <div className="w-40">
              <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <span className="text-body-soft">a</span>
            <div className="w-40">
              <Input
                type="date"
                value={hasta}
                min={desde}
                max={todayISO()}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
          </div>
        }
      >
        Kilómetros vs TripDrive
      </PageTitle>

      {error ? (
        <Panel className="border-[--color-danger]/40 bg-red-50/60">
          <div className="flex gap-3 p-4">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-[--color-danger]" />
            <div>
              <p className="font-bold text-[--color-danger]">No se pudieron traer las rutas</p>
              <p className="mt-1 text-sm text-body">{error}</p>
            </div>
          </div>
        </Panel>
      ) : cargando ? (
        <Spinner label="Consultando TripDrive…" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric label="Turnos" value={turnos.length} />
            <Metric
              label="Cruzados con ruta"
              value={`${resumen.emparejados} / ${turnos.length}`}
              tone={resumen.emparejados < turnos.length ? 'warn' : 'ok'}
            />
            <Metric label="Km del chofer" value={km(resumen.kmNuestro)} hint="odómetro declarado" />
            <Metric label="Km del plan" value={km(resumen.kmPlan)} hint="TripDrive" />
            <Metric
              label="Diferencia"
              value={`${diferenciaTotal >= 0 ? '+' : ''}${km(diferenciaTotal)}`}
              tone={Math.abs(diferenciaTotal) > TOLERANCIA_KM * 2 ? 'warn' : 'ok'}
              hint={`${resumen.fueraDeTolerancia} turno(s) fuera de ±${TOLERANCIA_KM} km`}
            />
          </div>

          <Panel title={`Turno por turno (${filas.length})`}>
            <Tabla
              columnas={['Fecha', 'Chofer', 'Unidad', 'Ruta en TripDrive', 'Km chofer', 'Km plan', 'Diferencia']}
              vacio="No hay turnos en el rango."
            >
              {filas.map((f) => {
                const fuera =
                  f.diferencia != null && Math.abs(f.diferencia) > TOLERANCIA_KM
                return (
                  <tr key={f.turno.id}>
                    <Td className="whitespace-nowrap">{shortDate(f.turno.fecha)}</Td>
                    <Td className="font-medium text-ink">{f.turno.chofer?.nombre ?? '—'}</Td>
                    <Td className="font-mono">{f.turno.unidad?.placa ?? '—'}</Td>
                    <Td className="max-w-xs">
                      {f.ruta ? (
                        <span className="text-body">
                          {f.ruta.vehicle?.color ?? f.ruta.zone?.name ?? f.ruta.name}
                          <span className="block text-xs text-body-soft">
                            {f.ruta.stops} paradas · {f.ruta.driver?.name ?? 'sin chofer'}
                          </span>
                        </span>
                      ) : (
                        <Badge tone="neutral">Sin ruta</Badge>
                      )}
                    </Td>
                    <Td className="tabular-nums">
                      {f.kmNuestro != null ? (
                        km(f.kmNuestro)
                      ) : (
                        <span
                          className="text-accent-600"
                          title="El odómetro no da un número creíble o el turno no se cerró"
                        >
                          —
                        </span>
                      )}
                    </Td>
                    <Td className="tabular-nums">{f.kmPlan != null ? km(f.kmPlan) : '—'}</Td>
                    <Td
                      className={
                        fuera ? 'font-semibold tabular-nums text-accent-600' : 'tabular-nums'
                      }
                    >
                      {f.diferencia != null
                        ? `${f.diferencia >= 0 ? '+' : ''}${km(f.diferencia)}`
                        : '—'}
                      {fuera && ' ⚠'}
                    </Td>
                  </tr>
                )
              })}
            </Tabla>
          </Panel>

          {/* Una ruta sin turno es un día que el chofer no registró, o un
              cruce que falló porque las placas no coinciden entre sistemas. */}
          <Panel title={`Rutas de TripDrive sin turno (${rutasSueltas.length})`}>
            <Tabla
              columnas={['Fecha', 'Ruta', 'Chofer', 'Unidad', 'Paradas', 'Km plan']}
              vacio="Todas las rutas del rango cruzaron con un turno."
            >
              {rutasSueltas.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{shortDate(r.date)}</Td>
                  <Td className="max-w-xs text-body">{r.vehicle?.color ?? r.name}</Td>
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
