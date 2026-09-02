import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Input, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Metric, PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { clockTime, km, shortDate, todayISO } from '@/lib/format'
import {
  fallasRecientes,
  listarIncidencias,
  sinRegistrar,
  turnosDe,
  type IncidenciaAdmin,
  type TurnoAdmin,
} from '../queries'
import type { Chofer } from '@/lib/database.types'

function haceDias(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

export function Resumen() {
  const [fecha, setFecha] = useState(todayISO())
  const [turnos, setTurnos] = useState<TurnoAdmin[]>([])
  const [faltantes, setFaltantes] = useState<Chofer[]>([])
  const [incidencias, setIncidencias] = useState<IncidenciaAdmin[]>([])
  const [fallas, setFallas] = useState<Awaited<ReturnType<typeof fallasRecientes>>>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)

    Promise.all([
      turnosDe(fecha),
      sinRegistrar(fecha),
      listarIncidencias(true),
      fallasRecientes(haceDias(7)),
    ]).then(([t, f, i, fa]) => {
      if (!vigente) return
      setTurnos(t)
      setFaltantes(f)
      setIncidencias(i)
      setFallas(fa)
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [fecha])

  const abiertos = turnos.filter((t) => t.estado === 'en_progreso')
  const cerrados = turnos.filter((t) => t.estado === 'completado')
  // Los cerró el sistema a las 11:59 p.m. porque el chofer no lo hizo.
  const porSistema = turnos.filter((t) => t.cierre_automatico)

  return (
    <>
      <PageTitle
        action={
          <div className="w-44">
            <Input
              type="date"
              icon="calendar"
              value={fecha}
              max={todayISO()}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
        }
      >
        Resumen
      </PageTitle>

      {cargando ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Turnos abiertos" value={abiertos.length} tone="ok" hint="sin cerrar" />
            <Metric label="Turnos cerrados" value={cerrados.length} />
            <Metric
              label="Sin registrar"
              value={faltantes.length}
              tone={faltantes.length > 0 ? 'warn' : 'ok'}
              hint="choferes activos"
            />
            <Metric
              label="Incidencias"
              value={incidencias.length}
              tone={incidencias.length > 0 ? 'danger' : 'ok'}
              hint="abiertas o vistas"
            />
          </div>

          {porSistema.length > 0 && (
            <Panel className="border-[--color-danger]/40 bg-red-50/60">
              <div className="flex gap-3 p-4">
                <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-[--color-danger]" />
                <div>
                  <p className="font-bold text-[--color-danger]">
                    {porSistema.length === 1
                      ? '1 turno lo cerró el sistema'
                      : `${porSistema.length} turnos los cerró el sistema`}
                  </p>
                  <p className="mt-1 text-sm text-body">
                    {porSistema.map((t) => t.chofer?.nombre ?? '—').join(', ')} no cerró su ruta
                    antes de las 11:59 p.m. Quedó sin kilometraje final ni firma, y ya se le avisó
                    que cuenta como falta.
                  </p>
                </div>
              </div>
            </Panel>
          )}

          {/* Lo que el admin realmente viene a buscar: quién falta. */}
          <Panel
            title={`Sin registrar el ${shortDate(fecha)}`}
            action={<span className="text-sm text-body-soft">{faltantes.length} chofer(es)</span>}
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
            title={`Turnos del ${shortDate(fecha)}`}
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
              {turnos.map((t) => {
                const recorrido =
                  t.km_inicial != null && t.km_final != null ? t.km_final - t.km_inicial : null
                return (
                  <tr key={t.id}>
                    <Td className="font-medium text-ink">{t.chofer?.nombre ?? '—'}</Td>
                    <Td>{t.unidad?.placa ?? '—'}</Td>
                    <Td className="tabular-nums">{clockTime(t.entrada_el)}</Td>
                    <Td className="tabular-nums">{clockTime(t.salida_el)}</Td>
                    <Td className="tabular-nums">{recorrido != null ? km(recorrido) : '—'}</Td>
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

          <Panel title="Fallas reportadas (últimos 7 días)">
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
