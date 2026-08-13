import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { clockTime, km, unidadLabel } from '@/lib/format'
import type { ChecklistDraft } from '@/lib/offline'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-body-soft">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

/**
 * Pantalla final de apertura y de cierre. La diferencia importa: al abrir, lo
 * que el chofer necesita saber es qué se le desbloqueó; al cerrar, que su
 * turno quedó registrado.
 */
export function StepDone({
  draft,
  fotos,
  modo,
}: {
  draft: ChecklistDraft
  fotos: number
  modo: 'apertura' | 'cierre'
}) {
  const navigate = useNavigate()
  const { unidad } = useAuth()
  const { online, pending, fallidos, ultimoError } = useSync()

  const esApertura = modo === 'apertura'

  // Tres estados distintos, no dos. Antes cualquier cosa con la cola llena
  // decía "se envía cuando tengas señal", incluso con señal y mientras estaba
  // subiendo — y también cuando había fallado y no iba a subir nunca.
  const estado = fallidos > 0 ? 'error' : !online ? 'sin_señal' : pending > 0 ? 'enviando' : 'enviado'

  const mensaje = {
    error: 'Se guardó en tu teléfono, pero no se pudo enviar.',
    sin_señal: 'Se guardó en tu teléfono y se envía solo en cuanto tengas señal.',
    enviando: 'Guardado. Enviando…',
    enviado: esApertura ? 'Tu check list de entrada quedó registrado.' : 'Tu turno se cerró correctamente.',
  }[estado]

  return (
    <div className="safe-top flex min-h-dvh flex-col justify-between p-4">
      <div className="space-y-4 pt-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-500 text-white">
            <Icon name="check" size={40} strokeWidth={2.5} />
          </span>
          <h1 className="text-[22px] font-extrabold text-ink">
            {esApertura ? '¡Turno abierto!' : '¡Registro completado!'}
          </h1>
          <p className="max-w-xs text-sm text-body-soft">{mensaje}</p>

          {estado === 'error' && ultimoError && (
            <p className="max-w-xs rounded-xl bg-red-50 px-3.5 py-3 text-sm text-[--color-danger]">
              {ultimoError}
            </p>
          )}
        </div>

        {esApertura && (
          <Card className="bg-brand-50/60">
            <p className="mb-2 font-bold text-brand-700">Ya podés</p>
            <ul className="space-y-2">
              <li className="flex items-center gap-2.5 text-sm text-body">
                <Icon name="fuel" size={17} className="shrink-0 text-brand-600" />
                Registrar cargas de combustible
              </li>
              <li className="flex items-center gap-2.5 text-sm text-body">
                <Icon name="clipboard" size={17} className="shrink-0 text-brand-600" />
                Hacer el cierre cuando termines el turno
              </li>
            </ul>
          </Card>
        )}

        <Card>
          <p className="mb-1 font-bold text-brand-600">Detalle</p>
          <div className="divide-y divide-gray-100">
            <Row label="Entrada" value={clockTime(draft.entryAt)} />
            <Row label="Km inicial" value={km(draft.odometerStart)} />
            {!esApertura && <Row label="Salida" value={clockTime(draft.exitAt)} />}
            {!esApertura && <Row label="Km final" value={km(draft.odometerEnd)} />}
            {esApertura && <Row label="Fotos" value={`${fotos}`} />}
            <Row label="Unidad" value={unidadLabel(unidad)} />
          </div>
        </Card>
      </div>

      <div className="safe-bottom space-y-2 pt-6">
        <Button onClick={() => navigate('/')}>Ir al inicio</Button>
        <Button variant="secondary" onClick={() => navigate('/registros')}>
          Ver mis registros
        </Button>
      </div>
    </div>
  )
}
