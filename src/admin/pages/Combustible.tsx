import { useEffect, useMemo, useState } from 'react'
import { Input, Spinner } from '@/components/ui'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { liters, money, shortDate, todayISO } from '@/lib/format'
import { listarCargas, type CargaAdmin } from '../queries'

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

export function Combustible() {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(todayISO())
  const [cargas, setCargas] = useState<CargaAdmin[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    void listarCargas(desde, hasta).then((c) => {
      if (!vigente) return
      setCargas(c)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [desde, hasta])

  const totales = useMemo(() => {
    const gasto = cargas.reduce((s, c) => s + Number(c.total), 0)
    const litros = cargas.reduce((s, c) => s + Number(c.litros), 0)
    // Promedio ponderado, no promedio de precios: cargar 5 L caros y 100 L
    // baratos no da el mismo número, y el que importa es el del gasto real.
    const precioPromedio = litros > 0 ? gasto / litros : 0
    return { gasto, litros, precioPromedio }
  }, [cargas])

  const porUnidad = useMemo(() => {
    const mapa = new Map<string, { placa: string; litros: number; gasto: number; cargas: number }>()
    for (const c of cargas) {
      const placa = c.unidad?.placa ?? '—'
      const previo = mapa.get(placa) ?? { placa, litros: 0, gasto: 0, cargas: 0 }
      previo.litros += Number(c.litros)
      previo.gasto += Number(c.total)
      previo.cargas += 1
      mapa.set(placa, previo)
    }
    return [...mapa.values()].sort((a, b) => b.gasto - a.gasto)
  }, [cargas])

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
        Combustible
      </PageTitle>

      {cargando ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Gasto total" value={money(totales.gasto)} />
            <Metric label="Litros" value={liters(totales.litros)} />
            <Metric
              label="Precio promedio"
              value={money(totales.precioPromedio)}
              hint="ponderado por litros"
            />
            <Metric label="Cargas" value={cargas.length} />
          </div>

          <Panel title="Por unidad">
            <Tabla columnas={['Unidad', 'Cargas', 'Litros', 'Gasto']} vacio="Sin cargas en el rango.">
              {porUnidad.map((u) => (
                <tr key={u.placa}>
                  <Td className="font-mono font-medium text-ink">{u.placa}</Td>
                  <Td className="tabular-nums">{u.cargas}</Td>
                  <Td className="tabular-nums">{liters(u.litros)}</Td>
                  <Td className="tabular-nums font-semibold text-brand-600">{money(u.gasto)}</Td>
                </tr>
              ))}
            </Tabla>
          </Panel>

          <Panel title="Cargas">
            <Tabla
              columnas={['Fecha', 'Chofer', 'Unidad', 'Estación', 'Litros', '$/L', 'Total']}
              vacio="Sin cargas en el rango."
            >
              {cargas.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap">{shortDate(c.fecha)}</Td>
                  <Td className="font-medium text-ink">{c.chofer?.nombre ?? '—'}</Td>
                  <Td className="font-mono">{c.unidad?.placa ?? '—'}</Td>
                  <Td>{c.estacion || '—'}</Td>
                  <Td className="tabular-nums">{liters(Number(c.litros))}</Td>
                  <Td className="tabular-nums">{money(Number(c.precio_litro))}</Td>
                  <Td className="tabular-nums font-semibold">{money(Number(c.total))}</Td>
                </tr>
              ))}
            </Tabla>
          </Panel>
        </div>
      )}
    </>
  )
}
