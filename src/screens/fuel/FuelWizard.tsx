import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { WizardHeader } from '@/components/AppShell'
import { NumberField } from '@/components/NumberField'
import { Badge, Button, Card, Field, Input, SectionTitle, Spinner, TextArea } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useTurno } from '@/context/TurnoContext'
import { useSync } from '@/context/SyncContext'
import { supabase } from '@/lib/supabase'
import { currentCoords } from '@/lib/capture'
import { clockTime, liters as fmtLiters, money } from '@/lib/format'
import { cancelarSolicitud, crearSolicitud, solicitudVigente } from '@/lib/solicitudes'
import type { SolicitudCombustible } from '@/lib/database.types'
import { EvidenciaCarga } from './EvidenciaCarga'

/**
 * Combustible, en tres tiempos: el chofer PIDE, el admin AUTORIZA y recién
 * después se sube la evidencia.
 *
 * Antes se registraba la carga ya hecha y al panel le llegaba un gasto
 * consumado. Ahora el permiso va adelante, así que esta pantalla es sobre
 * todo un semáforo: según en qué estado esté la solicitud del chofer, muestra
 * el formulario para pedir, la espera, el rechazo con su motivo, o el
 * formulario del ticket.
 */
export function FuelWizard() {
  const navigate = useNavigate()
  const { chofer, unidad } = useAuth()
  const { online } = useSync()
  const { abierto, cargando: turnoCargando, checklistId, draft: turno } = useTurno()

  const [solicitud, setSolicitud] = useState<SolicitudCombustible | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estaciones, setEstaciones] = useState<string[]>([])
  const [subiendo, setSubiendo] = useState(false)

  // La unidad sale del turno abierto, NO de la asignación del chofer: esa
  // puede estar vacía y la solicitud moriría al enviarse.
  const unidadDelTurno = turno?.vehicleId ?? unidad?.id ?? null

  const recargar = useCallback(
    async (silencioso = false) => {
      if (!chofer) return
      if (!silencioso) setCargando(true)
      try {
        setSolicitud(await solicitudVigente(chofer.id))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo consultar tu solicitud')
      } finally {
        setCargando(false)
      }
    },
    [chofer],
  )

  useEffect(() => {
    void recargar()
  }, [recargar])

  // Mientras espera la respuesta, el chofer está parado en la gasolinera. El
  // sondeo corto es lo que hace que no tenga que estar saliendo y entrando.
  useEffect(() => {
    if (solicitud?.estado !== 'pendiente') return
    const id = setInterval(() => void recargar(true), 20_000)
    return () => clearInterval(id)
  }, [solicitud?.estado, recargar])

  // Estaciones que este chofer ya usó: evita tipear la misma cada vez.
  useEffect(() => {
    if (!chofer) return
    void supabase
      .from('cargas_combustible')
      .select('estacion')
      .eq('chofer_id', chofer.id)
      .not('estacion', 'is', null)
      .order('fecha', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setEstaciones([...new Set((data ?? []).map((row) => row.estacion).filter(Boolean))] as string[])
      })
  }, [chofer])

  if (turnoCargando || cargando) return <Spinner label="Cargando…" />
  if (!abierto) return <Navigate to="/" replace />

  // ------------------------------------------------- evidencia del ticket
  if (solicitud?.estado === 'aprobada' && subiendo) {
    return (
      <EvidenciaCarga
        solicitud={solicitud}
        estaciones={estaciones}
        onListo={() => {
          setSubiendo(false)
          void recargar()
        }}
      />
    )
  }

  return (
    <div className="min-h-dvh bg-surface-alt">
      <WizardHeader title="Carga de combustible" onBack={() => navigate('/')} />

      <div className="space-y-4 p-4">
        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-[--color-danger]">
            <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {solicitud?.estado === 'aprobada' && (
          <Aprobada solicitud={solicitud} onSubir={() => setSubiendo(true)} />
        )}

        {solicitud?.estado === 'pendiente' && (
          <EnEspera
            solicitud={solicitud}
            online={online}
            onRefrescar={() => void recargar()}
            onCancelada={() => void recargar()}
            onError={setError}
          />
        )}

        {(!solicitud || ['rechazada', 'cargada', 'cancelada'].includes(solicitud.estado)) && (
          <Pedir
            ultima={solicitud}
            online={online}
            estaciones={estaciones}
            empresaId={chofer?.empresa_id ?? null}
            choferId={chofer?.id ?? null}
            unidadId={unidadDelTurno}
            checklistId={checklistId}
            onCreada={(nueva) => setSolicitud(nueva)}
            onError={setError}
          />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- aprobada

function Aprobada({
  solicitud,
  onSubir,
}: {
  solicitud: SolicitudCombustible
  onSubir: () => void
}) {
  const autorizados = solicitud.litros_autorizados ?? solicitud.litros

  return (
    <>
      <Card className="flex flex-col items-center gap-3 py-7 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
          <Icon name="checkCircle" size={32} />
        </span>
        <div>
          <p className="text-[17px] font-extrabold text-ink">Carga autorizada</p>
          <p className="mt-1 text-sm text-body-soft">
            {autorizados != null
              ? `Podés cargar hasta ${fmtLiters(autorizados)}.`
              : 'Podés cargar.'}
          </p>
        </div>
        {solicitud.estacion && (
          <Badge tone="neutral">
            <span className="inline-flex items-center gap-1">
              <Icon name="mapPin" size={13} />
              {solicitud.estacion}
            </span>
          </Badge>
        )}
      </Card>

      {solicitud.nota && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-body-soft">
            Nota del supervisor
          </p>
          <p className="mt-1 text-sm text-ink">{solicitud.nota}</p>
        </Card>
      )}

      <ul className="space-y-2.5">
        {[
          'Cargá en la estación y pedí el ticket',
          'Tomá la foto del ticket desde acá',
          'Poné los litros y el precio tal cual salen impresos',
        ].map((paso) => (
          <li key={paso} className="flex items-center gap-2.5 text-sm text-body">
            <Icon name="checkCircle" size={17} className="shrink-0 text-brand-500" />
            {paso}
          </li>
        ))}
      </ul>

      <Button onClick={onSubir}>
        <Icon name="camera" size={18} />
        Subir evidencia del ticket
      </Button>
    </>
  )
}

// -------------------------------------------------------------- en espera

function EnEspera({
  solicitud,
  online,
  onRefrescar,
  onCancelada,
  onError,
}: {
  solicitud: SolicitudCombustible
  online: boolean
  onRefrescar: () => void
  onCancelada: () => void
  onError: (mensaje: string) => void
}) {
  const [cancelando, setCancelando] = useState(false)

  async function cancelar() {
    if (!window.confirm('¿Cancelar tu solicitud de carga?')) return
    setCancelando(true)
    try {
      await cancelarSolicitud(solicitud.id)
      onCancelada()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo cancelar')
    } finally {
      setCancelando(false)
    }
  }

  return (
    <>
      <Card className="flex flex-col items-center gap-3 py-7 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-accent-600">
          <Icon name="clock" size={30} />
        </span>
        <div>
          <p className="text-[17px] font-extrabold text-ink">Esperando aprobación</p>
          <p className="mt-1 max-w-xs text-sm text-body-soft">
            Tu supervisor tiene que autorizar la carga. Te llega un aviso en cuanto responda.
          </p>
        </div>
      </Card>

      <Card>
        <p className="mb-1 font-bold text-brand-600">Lo que pediste</p>
        <div className="divide-y divide-gray-100">
          <Dato label="Litros" valor={fmtLiters(solicitud.litros)} />
          <Dato label="Monto estimado" valor={money(solicitud.monto_estimado)} />
          <Dato label="Estación" valor={solicitud.estacion || '—'} />
          <Dato label="Enviada" valor={clockTime(solicitud.created_at)} />
          {solicitud.motivo && <Dato label="Motivo" valor={solicitud.motivo} />}
        </div>
      </Card>

      {!online && (
        <p className="flex items-start gap-2 rounded-xl bg-orange-50 px-3.5 py-2.5 text-sm text-accent-600">
          <Icon name="cloudOff" size={17} className="mt-0.5 shrink-0" />
          Sin señal no se puede ver la respuesta. Buscá cobertura y volvé a intentar.
        </p>
      )}

      <Button variant="secondary" onClick={onRefrescar}>
        <Icon name="refresh" size={17} />
        Ver si ya respondieron
      </Button>

      <Button variant="danger" loading={cancelando} onClick={() => void cancelar()}>
        Cancelar solicitud
      </Button>
    </>
  )
}

// ----------------------------------------------------------------- pedir

function Pedir({
  ultima,
  online,
  estaciones,
  empresaId,
  choferId,
  unidadId,
  checklistId,
  onCreada,
  onError,
}: {
  ultima: SolicitudCombustible | null
  online: boolean
  estaciones: string[]
  empresaId: string | null
  choferId: string | null
  unidadId: string | null
  checklistId: string | null
  onCreada: (solicitud: SolicitudCombustible) => void
  onError: (mensaje: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [litros, setLitros] = useState<number | null>(null)
  const [monto, setMonto] = useState<number | null>(null)
  const [estacion, setEstacion] = useState('')
  const [km, setKm] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')

  async function enviar() {
    if (!empresaId || !choferId || !unidadId) {
      onError('No pudimos identificar tu unidad. Abrí el turno de nuevo.')
      return
    }

    setEnviando(true)
    try {
      const coords = await currentCoords(5000)
      const creada = await crearSolicitud({
        empresaId,
        choferId,
        unidadId,
        checklistId,
        litros,
        montoEstimado: monto,
        estacion: estacion.trim() || null,
        km,
        motivo: motivo.trim() || null,
        lat: coords.lat,
        lng: coords.lng,
      })
      onCreada(creada)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud')
    } finally {
      setEnviando(false)
    }
  }

  const listo = litros != null && litros > 0

  return (
    <>
      {ultima?.estado === 'rechazada' && (
        <Card className="border border-red-100 bg-red-50/60">
          <p className="flex items-center gap-2 font-bold text-[--color-danger]">
            <Icon name="x" size={17} />
            Te rechazaron la última solicitud
          </p>
          <p className="mt-1 text-sm text-body">
            {ultima.nota || 'No dejaron un motivo. Consultá con tu supervisor.'}
          </p>
        </Card>
      )}

      {ultima?.estado === 'cargada' && (
        <Card className="border border-brand-100">
          <p className="flex items-center gap-2 font-bold text-brand-600">
            <Icon name="checkCircle" size={17} />
            Tu última carga quedó registrada
          </p>
          <p className="mt-1 text-sm text-body-soft">
            Si necesitás cargar de nuevo, pedí otra autorización.
          </p>
        </Card>
      )}

      {!abierto && (
        <>
          <Card className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <Icon name="fuel" size={38} />
            </span>
            <p className="max-w-xs text-sm text-body-soft">
              Antes de cargar, pedí la autorización. Cuando te la aprueben, subís la foto del
              ticket desde esta misma pantalla.
            </p>
          </Card>

          {!online && (
            <p className="flex items-start gap-2 rounded-xl bg-orange-50 px-3.5 py-2.5 text-sm text-accent-600">
              <Icon name="cloudOff" size={17} className="mt-0.5 shrink-0" />
              Necesitás señal para pedir la carga: del otro lado tiene que haber alguien que la
              apruebe.
            </p>
          )}

          <Button disabled={!online} onClick={() => setAbierto(true)}>
            Solicitar carga
          </Button>
        </>
      )}

      {abierto && (
        <>
          <SectionTitle hint="Decí cuánto necesitás. Tu supervisor puede autorizar menos.">
            Solicitud de carga
          </SectionTitle>

          <Field label="Litros que necesitás">
            <NumberField
              decimales
              icon="droplet"
              suffix="Lts"
              placeholder="40"
              value={litros}
              onChange={setLitros}
            />
          </Field>

          <Field label="Monto aproximado (opcional)" hint="Si te manejás por dinero y no por litros.">
            <NumberField
              decimales
              icon="file"
              suffix="$"
              placeholder="800"
              value={monto}
              onChange={setMonto}
            />
          </Field>

          <Field label="Estación (opcional)">
            <Input
              icon="mapPin"
              list="estaciones-solicitud"
              placeholder="Shell - Sucursal Norte"
              value={estacion}
              onChange={(event) => setEstacion(event.target.value)}
            />
          </Field>
          <datalist id="estaciones-solicitud">
            {estaciones.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>

          <Field label="Kilometraje actual (opcional)">
            <NumberField
              icon="gauge"
              suffix="km"
              placeholder="45230"
              value={km}
              onChange={setKm}
            />
          </Field>

          <Field label="Motivo (opcional)" hint="Sirve para que te aprueben más rápido.">
            <TextArea
              rows={3}
              placeholder="Voy a Querétaro y el tanque está en la reserva"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </Field>

          <Button
            loading={enviando}
            disabled={!listo || !online}
            onClick={() => void enviar()}
          >
            Enviar solicitud
          </Button>
          <Button variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
        </>
      )}
    </>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="shrink-0 text-body-soft">{label}</span>
      <span className="text-right font-medium text-ink">{valor}</span>
    </div>
  )
}
