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

export function StepDone({ draft, photoCount }: { draft: ChecklistDraft; photoCount: number }) {
  const navigate = useNavigate()
  const { unidad } = useAuth()
  const { online, pending } = useSync()

  const queued = !online || pending > 0

  return (
    <div className="safe-top flex min-h-dvh flex-col justify-between p-4">
      <div className="space-y-4 pt-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-500 text-white">
            <Icon name="check" size={40} strokeWidth={2.5} />
          </span>
          <h1 className="text-[22px] font-extrabold text-ink">¡Registro Completado!</h1>
          <p className="max-w-xs text-sm text-body-soft">
            {queued
              ? 'Se guardó en tu teléfono y se va a enviar solo en cuanto tengas señal.'
              : 'Tu check list se guardó exitosamente.'}
          </p>
        </div>

        {queued && (
          <div className="flex items-center gap-2 rounded-xl bg-orange-50 px-3.5 py-3 text-sm text-accent-600">
            <Icon name="cloudOff" size={17} className="shrink-0" />
            Pendiente de sincronizar. No cierres sesión hasta que se envíe.
          </div>
        )}

        <Card>
          <p className="mb-1 font-bold text-brand-600">Detalle del registro</p>
          <div className="divide-y divide-gray-100">
            <Row label="Entrada" value={clockTime(draft.entryAt)} />
            <Row label="Salida" value={clockTime(draft.exitAt)} />
            <Row label="Km inicial" value={km(draft.odometerStart)} />
            <Row label="Km final" value={km(draft.odometerEnd)} />
            <Row label="Fotos" value={`${photoCount}`} />
            <Row label="Unidad" value={unidadLabel(unidad)} />
          </div>
        </Card>
      </div>

      <div className="safe-bottom space-y-2 pt-6">
        <Button onClick={() => navigate('/registros')}>Ver mis registros</Button>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Ir al inicio
        </Button>
      </div>
    </div>
  )
}
