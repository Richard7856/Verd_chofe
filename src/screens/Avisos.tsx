import { useEffect } from 'react'
import { Card, EmptyState, Spinner, cx } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icons'
import { useAvisos } from '@/context/AvisosContext'
import { clockTime, shortDate } from '@/lib/format'
import type { TipoAviso } from '@/lib/database.types'

const ESTILO: Record<TipoAviso, { icon: IconName; color: string; fondo: string }> = {
  aviso: { icon: 'bell', color: 'text-brand-600', fondo: 'bg-brand-50' },
  recordatorio: { icon: 'clock', color: 'text-accent-600', fondo: 'bg-orange-50' },
  urgente: { icon: 'alert', color: 'text-[--color-danger]', fondo: 'bg-red-50' },
}

export function Avisos() {
  const { avisos, sinLeer, cargando, marcarTodosLeidos } = useAvisos()

  // Se marcan leídos al entrar: si el chofer abrió la pantalla, los vio.
  // Pedirle además que toque "marcar leído" es trabajo que no aporta nada.
  useEffect(() => {
    if (sinLeer > 0) void marcarTodosLeidos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="p-4">
      <h1 className="mb-4 text-[22px] font-extrabold text-ink">Avisos</h1>

      {cargando ? (
        <Spinner />
      ) : avisos.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="bell"
            title="No tenés avisos"
            description="Acá van a aparecer los mensajes de tu supervisor y los recordatorios."
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {avisos.map((aviso) => {
            const estilo = ESTILO[aviso.tipo] ?? ESTILO.aviso
            const nuevo = !aviso.leido_el

            return (
              <li key={aviso.id}>
                <Card className={cx(nuevo && 'border border-brand-200')}>
                  <div className="flex gap-3">
                    <span
                      className={cx(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        estilo.fondo,
                        estilo.color,
                      )}
                    >
                      <Icon name={estilo.icon} size={17} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 font-semibold text-ink">{aviso.titulo}</p>
                        {nuevo && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-body">{aviso.cuerpo}</p>
                      <p className="mt-1.5 text-xs text-body-soft">
                        {shortDate(aviso.created_at)} · {clockTime(aviso.created_at)}
                        {aviso.origen === 'automatico' && ' · automático'}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
