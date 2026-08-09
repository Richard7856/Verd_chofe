import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useSync } from '@/context/SyncContext'
import { getOutbox } from '@/lib/offline'
import { isNative } from '@/lib/capture'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-body-soft">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

export function Settings() {
  const { online, pending, syncing, sync, refreshPending } = useSync()
  const [failed, setFailed] = useState(0)

  useEffect(() => {
    void getOutbox().then((entries) => setFailed(entries.filter((e) => e.status === 'failed').length))
  }, [pending])

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-[22px] font-extrabold text-ink">Configuración</h1>

      <Card>
        <p className="mb-1 font-bold text-brand-600">Estado</p>
        <div className="divide-y divide-gray-100">
          <Row label="Conexión" value={online ? 'En línea' : 'Sin conexión'} />
          <Row label="Registros pendientes" value={`${pending}`} />
          <Row label="Con error" value={`${failed}`} />
          <Row label="Plataforma" value={isNative ? 'App Android' : 'Navegador'} />
          <Row label="Versión" value="1.0.0" />
        </div>

        <Button
          variant="secondary"
          className="mt-3"
          loading={syncing}
          disabled={!online || pending === 0}
          onClick={() => void sync()}
        >
          <Icon name="refresh" size={17} />
          Sincronizar ahora
        </Button>
      </Card>

      {failed > 0 && (
        <div className="flex gap-2.5 rounded-xl bg-orange-50 p-3.5 text-sm">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-accent-600" />
          <p className="text-body">
            Hay {failed} registro{failed === 1 ? '' : 's'} que no se pudo enviar. Se reintenta solo
            cada vez que vuelve la señal. Si sigue fallando, avisale a tu supervisor —{' '}
            <strong>no borres la app</strong>, perderías esos registros.
          </p>
        </div>
      )}

      <Card>
        <p className="mb-1 font-bold text-brand-600">Almacenamiento</p>
        <p className="text-sm text-body-soft">
          Las fotos y los check lists sin enviar viven en este teléfono hasta que se
          sincronizan. Después se borran solos.
        </p>
        <Button variant="ghost" className="mt-2" onClick={() => void refreshPending()}>
          Actualizar estado
        </Button>
      </Card>
    </div>
  )
}
