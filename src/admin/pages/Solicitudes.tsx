import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Field, Input, Spinner, cx } from '@/components/ui'
import { NumberField } from '@/components/NumberField'
import { Icon } from '@/components/Icons'
import { PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { clockTime, liters, money, shortDate, todayISO } from '@/lib/format'
import {
  historialSolicitudes,
  resolverSolicitud,
  solicitudesPendientes,
  type SolicitudAdmin,
} from '../queries'
import type { EstadoSolicitud } from '@/lib/database.types'

/** Cada cuánto se busca si llegó una solicitud nueva. */
const REFRESCO_MS = 30_000

const ESTADOS: Record<EstadoSolicitud, { label: string; tone: 'success' | 'warn' | 'danger' | 'neutral' }> = {
  pendiente: { label: 'Pendiente', tone: 'warn' },
  aprobada: { label: 'Aprobada', tone: 'success' },
  rechazada: { label: 'Rechazada', tone: 'danger' },
  cargada: { label: 'Cargada', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'neutral' },
}

function haceCuanto(iso: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.round(horas / 24)} d`
}

function haceDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`)
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Autorizaciones de carga.
 *
 * Esta pantalla es el cuello del circuito nuevo: hasta que alguien contesta
 * acá, el chofer no puede cargar. Por eso las pendientes salen completas y
 * ordenadas de la más vieja a la más nueva, y la pantalla se refresca sola —
 * una solicitud que nadie ve es un camión detenido.
 */
export function Solicitudes() {
  const [pendientes, setPendientes] = useState<SolicitudAdmin[]>([])
  const [historial, setHistorial] = useState<SolicitudAdmin[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState(() => haceDias(todayISO(), 7))
  const [hasta, setHasta] = useState(todayISO)

  const refrescar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setCargando(true)
      try {
        const [p, h] = await Promise.all([
          solicitudesPendientes(),
          historialSolicitudes(desde, hasta),
        ])
        setPendientes(p)
        setHistorial(h)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las solicitudes')
      } finally {
        setCargando(false)
      }
    },
    [desde, hasta],
  )

  useEffect(() => {
    void refrescar()
  }, [refrescar])

  useEffect(() => {
    const id = setInterval(() => void refrescar(true), REFRESCO_MS)
    return () => clearInterval(id)
  }, [refrescar])

  return (
    <>
      <PageTitle
        action={
          <Button block={false} variant="secondary" onClick={() => void refrescar()}>
            <Icon name="refresh" size={16} />
            Actualizar
          </Button>
        }
      >
        Solicitudes de carga
      </PageTitle>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {cargando ? (
        <Spinner />
      ) : (
        <>
          <Panel
            title={pendientes.length ? `Por autorizar (${pendientes.length})` : 'Por autorizar'}
            className="mb-5"
          >
            {pendientes.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-body-soft">
                Ningún chofer está esperando autorización.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {pendientes.map((s) => (
                  <TarjetaPendiente
                    key={s.id}
                    solicitud={s}
                    onResuelta={() => void refrescar(true)}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Historial"
            action={
              <div className="flex items-center gap-2">
                <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
                <span className="text-xs text-body-soft">a</span>
                <Input type="date" value={hasta} min={desde} max={todayISO()} onChange={(e) => setHasta(e.target.value)} />
              </div>
            }
          >
            <Tabla
              columnas={['Fecha', 'Chofer', 'Unidad', 'Pidió', 'Autorizado', 'Estado', 'Nota']}
              vacio="Sin solicitudes resueltas en el rango."
            >
              {historial.map((s) => (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap text-body-soft">
                    {shortDate(s.fecha)}
                    <span className="ml-1 text-xs">{clockTime(s.created_at)}</span>
                  </Td>
                  <Td className="font-medium text-ink">{s.chofer?.nombre ?? '—'}</Td>
                  <Td className="font-mono text-xs">{s.unidad?.placa ?? '—'}</Td>
                  <Td className="tabular-nums">{liters(s.litros)}</Td>
                  <Td
                    className={cx(
                      'tabular-nums',
                      s.litros_autorizados != null &&
                        s.litros != null &&
                        s.litros_autorizados < s.litros &&
                        'font-semibold text-accent-600',
                    )}
                  >
                    {s.litros_autorizados != null ? liters(s.litros_autorizados) : '—'}
                  </Td>
                  <Td>
                    <Badge tone={ESTADOS[s.estado].tone}>{ESTADOS[s.estado].label}</Badge>
                  </Td>
                  <Td className="max-w-[220px]">
                    <span className="block truncate text-body-soft" title={s.nota ?? undefined}>
                      {s.nota || '—'}
                    </span>
                  </Td>
                </tr>
              ))}
            </Tabla>
          </Panel>
        </>
      )}
    </>
  )
}

// ------------------------------------------------------------- tarjeta

function TarjetaPendiente({
  solicitud,
  onResuelta,
  onError,
}: {
  solicitud: SolicitudAdmin
  onResuelta: () => void
  onError: (mensaje: string) => void
}) {
  const [litrosAut, setLitrosAut] = useState<number | null>(solicitud.litros)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState<'aprobada' | 'rechazada' | null>(null)

  async function resolver(estado: 'aprobada' | 'rechazada') {
    setEnviando(estado)
    try {
      await resolverSolicitud(solicitud.id, estado, {
        litros_autorizados: litrosAut,
        nota: nota.trim() || null,
      })
      onResuelta()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo guardar la respuesta')
    } finally {
      setEnviando(null)
    }
  }

  const recorta = litrosAut != null && solicitud.litros != null && litrosAut < solicitud.litros

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[15px] font-bold text-ink">{solicitud.chofer?.nombre ?? 'Chofer'}</p>
          <Badge tone="neutral">{solicitud.unidad?.placa ?? 'sin unidad'}</Badge>
          <span className="text-xs text-body-soft">{haceCuanto(solicitud.created_at)}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Dato icono="droplet" texto={`Pide ${liters(solicitud.litros)}`} fuerte />
          {solicitud.monto_estimado != null && (
            <Dato icono="file" texto={`≈ ${money(solicitud.monto_estimado)}`} />
          )}
          {solicitud.estacion && <Dato icono="mapPin" texto={solicitud.estacion} />}
          {solicitud.km != null && (
            <Dato icono="gauge" texto={`${solicitud.km.toLocaleString('es-MX')} km`} />
          )}
        </div>

        {solicitud.motivo && (
          <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-body">
            “{solicitud.motivo}”
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        <Field
          label="Litros que autorizás"
          hint={recorta ? 'Menos de lo que pidió: le va a llegar avisado.' : undefined}
        >
          <NumberField
            decimales
            icon="droplet"
            suffix="Lts"
            value={litrosAut}
            onChange={setLitrosAut}
          />
        </Field>

        <Field label="Nota o motivo">
          <Input
            placeholder="Para rechazar, explicá por qué"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </Field>

        <div className="flex gap-2">
          <Button
            block={false}
            className="flex-1"
            variant="success"
            loading={enviando === 'aprobada'}
            disabled={enviando != null}
            onClick={() => void resolver('aprobada')}
          >
            Aprobar
          </Button>
          <Button
            block={false}
            className="flex-1"
            variant="danger"
            loading={enviando === 'rechazada'}
            disabled={enviando != null || nota.trim().length < 3}
            onClick={() => void resolver('rechazada')}
          >
            Rechazar
          </Button>
        </div>
        {nota.trim().length < 3 && (
          <p className="text-center text-xs text-body-soft">
            Para rechazar hace falta un motivo: el chofer lo lee en su app.
          </p>
        )}
      </div>
    </div>
  )
}

function Dato({ icono, texto, fuerte }: { icono: 'droplet' | 'file' | 'mapPin' | 'gauge'; texto: string; fuerte?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5', fuerte ? 'font-semibold text-ink' : 'text-body')}>
      <Icon name={icono} size={15} className="text-body-soft" />
      {texto}
    </span>
  )
}
