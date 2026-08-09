import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { useSync } from '@/context/SyncContext'
import { useTurno } from '@/context/TurnoContext'
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
  const { online, pending, syncing } = useSync()
  const { abierto } = useTurno()
  const [conError, setConError] = useState(0)

  useEffect(() => {
    void getOutbox().then((entries) => setConError(entries.filter((e) => e.status === 'failed').length))
  }, [pending])

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-[22px] font-extrabold text-ink">Configuración</h1>

      <Card>
        <p className="mb-1 font-bold text-brand-600">Estado</p>
        <div className="divide-y divide-gray-100">
          <Row label="Turno" value={abierto ? 'Abierto' : 'Cerrado'} />
          <Row label="Conexión" value={online ? 'En línea' : 'Sin conexión'} />
          <Row
            label="Registros por enviar"
            value={pending === 0 ? 'Ninguno' : `${pending}${syncing ? ' · enviando…' : ''}`}
          />
          <Row label="Plataforma" value={isNative ? 'App Android' : 'Navegador'} />
          <Row label="Versión" value="1.0.0" />
        </div>
      </Card>

      <Card>
        <p className="mb-1 font-bold text-brand-600">Sincronización</p>
        <p className="text-sm text-body-soft">
          Es automática: los registros se envían solos al abrir la app, al recuperar la señal y
          cada tanto mientras quede algo pendiente. No hay nada que apretar.
        </p>
      </Card>

      {conError > 0 && (
        <div className="flex gap-2.5 rounded-xl bg-orange-50 p-3.5 text-sm">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-accent-600" />
          <p className="text-body">
            Hay {conError} registro{conError === 1 ? '' : 's'} que no se pudo enviar. Se sigue
            reintentando solo. Si después de un rato continúa, avisale a tu supervisor —{' '}
            <strong>no borres la app</strong>, perderías esos registros.
          </p>
        </div>
      )}

      <Card>
        <p className="mb-1 font-bold text-brand-600">Almacenamiento</p>
        <p className="text-sm text-body-soft">
          Las fotos y los registros sin enviar viven en este teléfono hasta que se sincronizan.
          Después se borran solos para no ocupar espacio.
        </p>
      </Card>
    </div>
  )
}
