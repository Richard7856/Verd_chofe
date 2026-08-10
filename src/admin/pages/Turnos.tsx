import { useEffect, useState } from 'react'
import { Badge, Input, Spinner, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { clockTime, km, shortDate, todayISO } from '@/lib/format'
import { detalleTurno, listarTurnos, type DetalleTurno, type TurnoAdmin } from '../queries'

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

const ETIQUETA_ESTADO: Record<string, { label: string; tone: 'success' | 'warn' | 'neutral' }> = {
  ok: { label: 'OK', tone: 'success' },
  no_ok: { label: 'No OK', tone: 'warn' },
  na: { label: 'N/A', tone: 'neutral' },
}

function Detalle({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const [datos, setDatos] = useState<DetalleTurno | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    setCargando(true)
    void detalleTurno(id).then((d) => {
      setDatos(d)
      setCargando(false)
    })
  }, [id])

  const fallas = datos?.items.filter((i) => i.estado === 'no_ok') ?? []

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onCerrar} aria-hidden="true" />

      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-surface-alt shadow-xl">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-3.5">
          <h2 className="flex-1 font-bold text-ink">Detalle del turno</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-body-soft">
            <Icon name="x" size={21} />
          </button>
        </header>

        {cargando || !datos ? (
          <Spinner />
        ) : (
          <div className="space-y-4 p-5">
            <Panel title="Turno">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 p-4 text-sm">
                <div>
                  <dt className="text-body-soft">Chofer</dt>
                  <dd className="font-medium text-ink">{datos.turno.chofer?.nombre ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-body-soft">Unidad</dt>
                  <dd className="font-medium text-ink">{datos.turno.unidad?.placa ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-body-soft">Entrada</dt>
                  <dd className="font-medium text-ink">{clockTime(datos.turno.entrada_el)}</dd>
                </div>
                <div>
                  <dt className="text-body-soft">Salida</dt>
                  <dd className="font-medium text-ink">{clockTime(datos.turno.salida_el)}</dd>
                </div>
                <div>
                  <dt className="text-body-soft">Km inicial</dt>
                  <dd className="font-medium tabular-nums text-ink">{km(datos.turno.km_inicial)}</dd>
                </div>
                <div>
                  <dt className="text-body-soft">Km final</dt>
                  <dd className="font-medium tabular-nums text-ink">{km(datos.turno.km_final)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-body-soft">Ruta / turno</dt>
                  <dd className="font-medium text-ink">{datos.turno.ruta_turno || '—'}</dd>
                </div>
                {datos.turno.observaciones && (
                  <div className="col-span-2">
                    <dt className="text-body-soft">Observaciones</dt>
                    <dd className="text-ink">{datos.turno.observaciones}</dd>
                  </div>
                )}
              </dl>
            </Panel>

            {fallas.length > 0 && (
              <Panel className="border-accent-400/50 bg-orange-50/50">
                <div className="p-4">
                  <p className="mb-2 flex items-center gap-2 font-bold text-accent-600">
                    <Icon name="alert" size={17} />
                    {fallas.length} punto{fallas.length === 1 ? '' : 's'} con novedad
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {fallas.map((f) => (
                      <li key={f.codigo}>
                        <span className="font-medium text-ink">{f.etiqueta}</span>
                        {f.nota && <span className="block text-body-soft">{f.nota}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            )}

            <Panel title={`Condiciones (${datos.items.length})`}>
              <ul className="divide-y divide-gray-100">
                {datos.items.map((i) => {
                  const e = ETIQUETA_ESTADO[i.estado] ?? { label: i.estado, tone: 'neutral' as const }
                  return (
                    <li key={i.codigo} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="flex-1 text-ink">{i.etiqueta}</span>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </li>
                  )
                })}
              </ul>
            </Panel>

            <Panel title={`Evidencia fotográfica (${datos.fotos.length})`}>
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
                {datos.fotos.map((f) => (
                  <figure key={f.codigo}>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer">
                        <img
                          src={f.url}
                          alt={f.etiqueta}
                          loading="lazy"
                          className="aspect-[4/3] w-full rounded-lg object-cover"
                        />
                      </a>
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-gray-100 text-body-soft">
                        <Icon name="image" size={20} />
                      </div>
                    )}
                    <figcaption className="mt-1 text-xs text-body-soft">{f.etiqueta}</figcaption>
                  </figure>
                ))}
                {datos.fotos.length === 0 && (
                  <p className="col-span-full py-6 text-center text-sm text-body-soft">
                    Sin fotos cargadas.
                  </p>
                )}
              </div>
            </Panel>

            {datos.firmaUrl && (
              <Panel title="Firma de conformidad">
                <img
                  src={datos.firmaUrl}
                  alt="Firma"
                  className="mx-auto my-3 max-h-40 bg-white p-2"
                />
              </Panel>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

export function Turnos() {
  const [desde, setDesde] = useState(haceDias(14))
  const [hasta, setHasta] = useState(todayISO())
  const [turnos, setTurnos] = useState<TurnoAdmin[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    void listarTurnos(desde, hasta).then((t) => {
      if (!vigente) return
      setTurnos(t)
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [desde, hasta])

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
        Turnos
      </PageTitle>

      <Panel>
        {cargando ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Fecha', 'Chofer', 'Unidad', 'Entrada', 'Salida', 'Recorrido', 'Estado', '']}
            vacio="No hay turnos en este rango."
          >
            {turnos.map((t) => {
              const recorrido =
                t.km_inicial != null && t.km_final != null ? t.km_final - t.km_inicial : null
              return (
                <tr
                  key={t.id}
                  onClick={() => setAbierto(t.id)}
                  className={cx('cursor-pointer hover:bg-brand-50/40')}
                >
                  <Td className="whitespace-nowrap">{shortDate(t.fecha)}</Td>
                  <Td className="font-medium text-ink">{t.chofer?.nombre ?? '—'}</Td>
                  <Td>{t.unidad?.placa ?? '—'}</Td>
                  <Td className="tabular-nums">{clockTime(t.entrada_el)}</Td>
                  <Td className="tabular-nums">{clockTime(t.salida_el)}</Td>
                  <Td className="tabular-nums">{recorrido != null ? km(recorrido) : '—'}</Td>
                  <Td>
                    <Badge tone={t.estado === 'completado' ? 'success' : 'warn'}>
                      {t.estado === 'completado' ? 'Cerrado' : 'Abierto'}
                    </Badge>
                  </Td>
                  <Td className="text-right text-body-soft">
                    <Icon name="chevronRight" size={16} />
                  </Td>
                </tr>
              )
            })}
          </Tabla>
        )}
      </Panel>

      {abierto && <Detalle id={abierto} onCerrar={() => setAbierto(null)} />}
    </>
  )
}
