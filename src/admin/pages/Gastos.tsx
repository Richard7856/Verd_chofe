import { useEffect, useMemo, useState } from 'react'
import { Badge, Input, Spinner } from '@/components/ui'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { CeldaFoto } from '../CeldaFoto'
import { money, shortDate, todayISO } from '@/lib/format'
import { listarGastos, type GastoAdmin } from '../queries'
import type { TipoGasto } from '@/lib/database.types'

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

const ETIQUETA: Record<TipoGasto, { label: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  aceite: { label: 'Aceite', tone: 'neutral' },
  anticongelante: { label: 'Anticongelante', tone: 'neutral' },
  ponchadura: { label: 'Ponchadura', tone: 'warn' },
  otro: { label: 'Otro', tone: 'danger' },
}

export function Gastos() {
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(todayISO())
  const [gastos, setGastos] = useState<GastoAdmin[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    void listarGastos(desde, hasta).then((g) => {
      if (!vigente) return
      setGastos(g)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [desde, hasta])

  const total = useMemo(() => gastos.reduce((s, g) => s + Number(g.monto), 0), [gastos])

  const porTipo = useMemo(() => {
    const mapa = new Map<string, { tipo: TipoGasto; monto: number; veces: number }>()
    for (const g of gastos) {
      const previo = mapa.get(g.tipo) ?? { tipo: g.tipo, monto: 0, veces: 0 }
      previo.monto += Number(g.monto)
      previo.veces += 1
      mapa.set(g.tipo, previo)
    }
    return [...mapa.values()].sort((a, b) => b.monto - a.monto)
  }, [gastos])

  const porUnidad = useMemo(() => {
    const mapa = new Map<string, { placa: string; monto: number; veces: number }>()
    for (const g of gastos) {
      const placa = g.unidad?.placa ?? '—'
      const previo = mapa.get(placa) ?? { placa, monto: 0, veces: 0 }
      previo.monto += Number(g.monto)
      previo.veces += 1
      mapa.set(placa, previo)
    }
    return [...mapa.values()].sort((a, b) => b.monto - a.monto)
  }, [gastos])

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
        Gastos extra
      </PageTitle>

      {cargando ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Total del periodo" value={money(total)} />
            <Metric label="Movimientos" value={gastos.length} />
            <Metric
              label="Ponchaduras"
              value={gastos.filter((g) => g.tipo === 'ponchadura').length}
              tone={gastos.filter((g) => g.tipo === 'ponchadura').length > 0 ? 'warn' : 'ok'}
              hint="posible desgaste de llantas"
            />
            <Metric
              label="Unidades con gasto"
              value={porUnidad.length}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Por tipo">
              <Tabla columnas={['Tipo', 'Veces', 'Monto']} vacio="Sin gastos en el rango.">
                {porTipo.map((t) => (
                  <tr key={t.tipo}>
                    <Td>
                      <Badge tone={ETIQUETA[t.tipo].tone}>{ETIQUETA[t.tipo].label}</Badge>
                    </Td>
                    <Td className="tabular-nums">{t.veces}</Td>
                    <Td className="tabular-nums font-semibold text-brand-600">{money(t.monto)}</Td>
                  </tr>
                ))}
              </Tabla>
            </Panel>

            <Panel title="Por unidad">
              <Tabla columnas={['Unidad', 'Veces', 'Monto']} vacio="Sin gastos en el rango.">
                {porUnidad.map((u) => (
                  <tr key={u.placa}>
                    <Td className="font-mono font-medium text-ink">{u.placa}</Td>
                    <Td className="tabular-nums">{u.veces}</Td>
                    <Td className="tabular-nums font-semibold text-brand-600">{money(u.monto)}</Td>
                  </tr>
                ))}
              </Tabla>
            </Panel>
          </div>

          <Panel title="Movimientos">
            <Tabla
              columnas={['Fecha', 'Chofer', 'Unidad', 'Tipo', 'Detalle', 'Lugar', 'Monto', 'Ticket']}
              vacio="Sin gastos en el rango."
            >
              {gastos.map((g) => (
                <tr key={g.id}>
                  <Td className="whitespace-nowrap">{shortDate(g.fecha)}</Td>
                  <Td className="font-medium text-ink">{g.chofer?.nombre ?? '—'}</Td>
                  <Td className="font-mono">{g.unidad?.placa ?? '—'}</Td>
                  <Td>
                    <Badge tone={ETIQUETA[g.tipo].tone}>{ETIQUETA[g.tipo].label}</Badge>
                  </Td>
                  <Td className="max-w-xs text-body">{g.descripcion || '—'}</Td>
                  <Td className="text-body-soft">{g.lugar || '—'}</Td>
                  <Td className="tabular-nums font-semibold">{money(Number(g.monto))}</Td>
                  <Td>
                    <CeldaFoto
                      url={g.ticket_url}
                      titulo={`Ticket de ${ETIQUETA[g.tipo].label.toLowerCase()} · ${g.chofer?.nombre ?? '—'} · ${shortDate(g.fecha)}`}
                    />
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
