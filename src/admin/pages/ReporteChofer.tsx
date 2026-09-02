import { useEffect, useMemo, useState } from 'react'
import { Badge, Input, Select, Spinner } from '@/components/ui'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { km, liters, money, shortDate, todayISO } from '@/lib/format'
import {
  listarChoferes,
  reporteChofer,
  type CargaReporte,
  type GastoReporte,
  type IncidenciaReporte,
} from '../queries'
import type { Chofer } from '@/lib/database.types'

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/** Un turno con más de esto (o negativo) es un dedazo en el odómetro. */
const KM_MAXIMO_CREIBLE = 1500

const TIPO_GASTO: Record<string, string> = {
  aceite: 'Aceite',
  anticongelante: 'Anticongelante',
  ponchadura: 'Ponchadura',
  otro: 'Otro',
}

/**
 * Todo lo que hizo UN chofer en un rango de fechas: turnos, kilómetros,
 * combustible, gastos e incidencias. Es la vista para responder "¿qué hizo
 * Juan este mes?" sin saltar entre secciones.
 */
export function ReporteChofer() {
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [choferId, setChoferId] = useState('')
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(todayISO())
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof reporteChofer>> | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    void listarChoferes().then((c) => {
      setChoferes(c)
      setChoferId((previo) => previo || (c[0]?.id ?? ''))
      if (c.length === 0) setCargando(false)
    })
  }, [])

  useEffect(() => {
    if (!choferId) return
    let vigente = true
    setCargando(true)
    void reporteChofer(choferId, desde, hasta).then((r) => {
      if (!vigente) return
      setDatos(r)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [choferId, desde, hasta])

  const resumen = useMemo(() => {
    if (!datos) return null

    // Los recorridos increíbles no se suman: un 44 000 en el odómetro
    // arruinaría el total del mes. Se cuentan aparte y se marcan en la tabla.
    let kmTotal = 0
    let kmSospechosos = 0
    for (const t of datos.turnos) {
      if (t.km_inicial == null || t.km_final == null) continue
      const recorrido = t.km_final - t.km_inicial
      if (recorrido < 0 || recorrido > KM_MAXIMO_CREIBLE) kmSospechosos += 1
      else kmTotal += recorrido
    }

    const litros = datos.cargas.reduce((s, c) => s + Number(c.litros), 0)
    const gastoCombustible = datos.cargas.reduce((s, c) => s + Number(c.total), 0)
    const gastosExtra = datos.gastos.reduce((s, g) => s + Number(g.monto), 0)

    return {
      kmTotal,
      kmSospechosos,
      litros,
      gastoCombustible,
      gastosExtra,
      rendimiento: litros > 0 ? kmTotal / litros : null,
      turnosCerrados: datos.turnos.filter((t) => t.estado === 'completado').length,
      // Turnos que el chofer no cerró y cerró el sistema a las 11:59 p.m.
      sinCerrar: datos.turnos.filter((t) => t.cierre_automatico).length,
    }
  }, [datos])

  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-52">
              <Select
                value={choferId}
                onChange={setChoferId}
                options={choferes.map((c) => ({
                  value: c.id,
                  label: c.activo ? c.nombre : `${c.nombre} (inactivo)`,
                }))}
              />
            </div>
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
        Reporte por chofer
      </PageTitle>

      {choferes.length === 0 && !cargando ? (
        <Panel>
          <p className="px-4 py-10 text-center text-sm text-body-soft">
            Todavía no hay choferes dados de alta.
          </p>
        </Panel>
      ) : cargando || !datos || !resumen ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Metric label="Turnos cerrados" value={resumen.turnosCerrados} />
            <Metric
              label="Km recorridos"
              value={km(resumen.kmTotal)}
              hint={
                resumen.kmSospechosos > 0
                  ? `sin contar ${resumen.kmSospechosos} turno${resumen.kmSospechosos === 1 ? '' : 's'} con km sospechoso`
                  : undefined
              }
              tone={resumen.kmSospechosos > 0 ? 'warn' : 'neutral'}
            />
            <Metric label="Litros cargados" value={liters(resumen.litros)} />
            <Metric
              label="Rendimiento"
              value={resumen.rendimiento != null ? `${resumen.rendimiento.toFixed(1)} km/L` : '—'}
              hint="km recorridos por litro"
            />
            <Metric label="Combustible" value={money(resumen.gastoCombustible)} />
            <Metric label="Gastos extra" value={money(resumen.gastosExtra)} />
          </div>

          {resumen.sinCerrar > 0 && (
            <Panel className="border-[--color-danger]/40 bg-red-50/60">
              <p className="p-4 text-sm font-semibold text-[--color-danger]">
                {resumen.sinCerrar === 1
                  ? '1 turno no lo cerró el chofer: lo cerró el sistema a las 11:59 p.m. y cuenta como falta.'
                  : `${resumen.sinCerrar} turnos no los cerró el chofer: los cerró el sistema a las 11:59 p.m. y cuentan como faltas.`}
              </p>
            </Panel>
          )}

          <Panel title={`Turnos (${datos.turnos.length})`}>
            <Tabla
              columnas={['Fecha', 'Unidad', 'Km inicial', 'Km final', 'Recorrido', 'Estado']}
              vacio="Sin turnos en el rango."
            >
              {datos.turnos.map((t) => {
                const recorrido =
                  t.km_inicial != null && t.km_final != null ? t.km_final - t.km_inicial : null
                const sospechoso =
                  recorrido != null && (recorrido < 0 || recorrido > KM_MAXIMO_CREIBLE)
                return (
                  <tr key={t.id}>
                    <Td className="whitespace-nowrap">{shortDate(t.fecha)}</Td>
                    <Td className="font-mono">{t.unidad?.placa ?? '—'}</Td>
                    <Td className="tabular-nums">{t.km_inicial != null ? km(t.km_inicial) : '—'}</Td>
                    <Td className="tabular-nums">{t.km_final != null ? km(t.km_final) : '—'}</Td>
                    <Td
                      className={
                        sospechoso ? 'font-semibold tabular-nums text-accent-600' : 'tabular-nums'
                      }
                    >
                      <span title={sospechoso ? 'Kilometraje sospechoso: no se suma al total' : undefined}>
                        {recorrido != null ? km(recorrido) : '—'}
                        {sospechoso && ' ⚠'}
                      </span>
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

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title={`Cargas de combustible (${datos.cargas.length})`}>
              <Tabla
                columnas={['Fecha', 'Unidad', 'Estación', 'Litros', 'Total']}
                vacio="Sin cargas en el rango."
              >
                {datos.cargas.map((c: CargaReporte) => (
                  <tr key={c.id}>
                    <Td className="whitespace-nowrap">{shortDate(c.fecha)}</Td>
                    <Td className="font-mono">{c.unidad?.placa ?? '—'}</Td>
                    <Td>{c.estacion || '—'}</Td>
                    <Td className="tabular-nums">{liters(Number(c.litros))}</Td>
                    <Td className="tabular-nums font-semibold">{money(Number(c.total))}</Td>
                  </tr>
                ))}
              </Tabla>
            </Panel>

            <Panel title={`Gastos extra (${datos.gastos.length})`}>
              <Tabla
                columnas={['Fecha', 'Tipo', 'Detalle', 'Monto']}
                vacio="Sin gastos en el rango."
              >
                {datos.gastos.map((g: GastoReporte) => (
                  <tr key={g.id}>
                    <Td className="whitespace-nowrap">{shortDate(g.fecha)}</Td>
                    <Td>{TIPO_GASTO[g.tipo] ?? g.tipo}</Td>
                    <Td className="max-w-xs text-body">{g.descripcion || g.lugar || '—'}</Td>
                    <Td className="tabular-nums font-semibold">{money(Number(g.monto))}</Td>
                  </tr>
                ))}
              </Tabla>
            </Panel>
          </div>

          <Panel title={`Incidencias (${datos.incidencias.length})`}>
            <Tabla
              columnas={['Fecha', 'Tipo', 'Descripción', 'Estado']}
              vacio="Sin incidencias en el rango."
            >
              {datos.incidencias.map((i: IncidenciaReporte) => (
                <tr key={i.id}>
                  <Td className="whitespace-nowrap">{shortDate(i.created_at)}</Td>
                  <Td>{i.tipo}</Td>
                  <Td className="max-w-sm text-body">{i.descripcion}</Td>
                  <Td>
                    <Badge tone={i.estado === 'resuelta' ? 'success' : 'warn'}>{i.estado}</Badge>
                  </Td>
                </tr>
              ))}
            </Tabla>
          </Panel>
        </div>
      )}
    </>
  )
}
