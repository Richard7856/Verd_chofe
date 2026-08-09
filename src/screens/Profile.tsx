import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { Badge, Button, Card } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { shortDate, unidadLabel } from '@/lib/format'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-body-soft">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

export function Profile() {
  const { profile, chofer, empresa, unidad, signOut } = useAuth()
  const { online, pending, syncing, sync } = useSync()

  const licenciaVencida =
    chofer?.licencia_vence_el != null && new Date(chofer.licencia_vence_el) < new Date()

  const nombre = chofer?.nombre || profile?.nombre || 'Chofer'

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-xl font-bold text-white">
          {nombre.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-extrabold text-ink">{nombre}</h1>
          <p className="truncate text-sm text-body-soft">{profile?.email}</p>
        </div>
      </div>

      <Card>
        <p className="mb-1 font-bold text-brand-600">Datos del chofer</p>
        <div className="divide-y divide-gray-100">
          <Row label="Empresa" value={empresa?.nombre ?? '—'} />
          <Row label="Teléfono" value={chofer?.telefono || '—'} />
          <Row label="Licencia" value={chofer?.licencia_numero || '—'} />
          <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
            <span className="text-body-soft">Vence</span>
            <span className="flex items-center gap-2">
              <span className="font-medium text-ink">{shortDate(chofer?.licencia_vence_el)}</span>
              {licenciaVencida && <Badge tone="danger">Vencida</Badge>}
            </span>
          </div>
          <Row label="Unidad" value={unidadLabel(unidad)} />
        </div>
      </Card>

      {licenciaVencida && (
        <div className="flex gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-[--color-danger]" />
          <p className="text-body">
            Tu licencia está vencida. Avisale a tu supervisor antes de salir a ruta.
          </p>
        </div>
      )}

      <Card>
        <p className="mb-1 font-bold text-brand-600">Sincronización</p>
        <div className="divide-y divide-gray-100">
          <Row label="Conexión" value={online ? 'En línea' : 'Sin conexión'} />
          <Row label="Pendientes" value={`${pending}`} />
        </div>

        {pending > 0 && online && (
          <Button variant="secondary" className="mt-3" loading={syncing} onClick={() => void sync()}>
            Sincronizar ahora
          </Button>
        )}
      </Card>

      <Button variant="danger" onClick={() => void signOut()}>
        <Icon name="logout" size={17} />
        Cerrar sesión
      </Button>

      {pending > 0 && (
        <p className="text-center text-xs text-accent-600">
          Tenés {pending} registro{pending === 1 ? '' : 's'} sin enviar. Si cerrás sesión, quedan
          guardados en este teléfono hasta que vuelvas a entrar.
        </p>
      )}
    </div>
  )
}
