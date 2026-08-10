import { useEffect, useState } from 'react'
import { Badge, Spinner, cx } from '@/components/ui'
import { PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { shortDate } from '@/lib/format'
import { cambiarEstadoIncidencia, listarIncidencias, type IncidenciaAdmin } from '../queries'
import type { EstadoIncidencia } from '@/lib/database.types'

const ESTADOS: Record<EstadoIncidencia, { label: string; tone: 'warn' | 'success' | 'neutral' }> = {
  abierta: { label: 'Abierta', tone: 'warn' },
  vista: { label: 'Vista', tone: 'neutral' },
  resuelta: { label: 'Resuelta', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'neutral' },
}

const TIPOS: Record<string, string> = {
  camino: 'En el camino',
  unidad: 'Con la unidad',
  entrega: 'En una entrega',
  otro: 'Otro',
}

export function Incidencias() {
  const [filas, setFilas] = useState<IncidenciaAdmin[]>([])
  const [soloAbiertas, setSoloAbiertas] = useState(true)
  const [cargando, setCargando] = useState(true)

  async function refrescar() {
    setCargando(true)
    setFilas(await listarIncidencias(soloAbiertas))
    setCargando(false)
  }

  useEffect(() => {
    void refrescar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloAbiertas])

  async function cambiar(id: string, estado: EstadoIncidencia) {
    await cambiarEstadoIncidencia(id, estado)
    await refrescar()
  }

  return (
    <>
      <PageTitle
        action={
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {[
              { id: true, label: 'Pendientes' },
              { id: false, label: 'Todas' },
            ].map((o) => (
              <button
                key={String(o.id)}
                type="button"
                onClick={() => setSoloAbiertas(o.id)}
                className={cx(
                  'rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors',
                  soloAbiertas === o.id ? 'bg-white text-brand-600 shadow-sm' : 'text-body-soft',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        }
      >
        Incidencias
      </PageTitle>

      <Panel>
        {cargando ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Fecha', 'Chofer', 'Unidad', 'Tipo', 'Descripción', 'Estado', '']}
            vacio={soloAbiertas ? 'No hay incidencias pendientes.' : 'Todavía no hay incidencias.'}
          >
            {filas.map((f) => {
              const estado = ESTADOS[f.estado] ?? { label: f.estado, tone: 'neutral' as const }
              return (
                <tr key={f.id}>
                  <Td className="whitespace-nowrap">{shortDate(f.created_at)}</Td>
                  <Td className="font-medium text-ink">{f.chofer?.nombre ?? '—'}</Td>
                  <Td className="font-mono">{f.unidad?.placa ?? '—'}</Td>
                  <Td>{TIPOS[f.tipo] ?? f.tipo}</Td>
                  <Td className="max-w-sm text-body">{f.descripcion}</Td>
                  <Td>
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-3 whitespace-nowrap">
                      {f.estado === 'abierta' && (
                        <button
                          type="button"
                          onClick={() => void cambiar(f.id, 'vista')}
                          className="text-xs font-semibold text-body-soft hover:underline"
                        >
                          Marcar vista
                        </button>
                      )}
                      {f.estado !== 'resuelta' && f.estado !== 'cancelada' && (
                        <button
                          type="button"
                          onClick={() => void cambiar(f.id, 'resuelta')}
                          className="text-xs font-semibold text-brand-600 hover:underline"
                        >
                          Resolver
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Tabla>
        )}
      </Panel>
    </>
  )
}
