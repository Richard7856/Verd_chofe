import { Card } from '@/components/ui'
import { Icon, type IconName } from '@/components/Icons'

/**
 * Documentos e Historial de Servicios están en el menú del diseño pero no
 * tienen tablas en la base. En vez de simular una pantalla vacía que parezca
 * rota, se dice explícitamente qué falta para habilitarlas.
 */
export function Placeholder({
  title,
  icon,
  description,
  needs,
}: {
  title: string
  icon: IconName
  description: string
  needs: string[]
}) {
  return (
    <div className="p-4">
      <h1 className="mb-4 text-[22px] font-extrabold text-ink">{title}</h1>

      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
          <Icon name={icon} size={30} />
        </span>
        <p className="font-semibold text-ink">Módulo en preparación</p>
        <p className="max-w-xs text-sm text-body-soft">{description}</p>
      </Card>

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-ink">Para habilitarlo hace falta:</p>
        <ul className="space-y-2">
          {needs.map((need) => (
            <li key={need} className="flex items-start gap-2.5 text-sm text-body">
              <Icon name="chevronRight" size={16} className="mt-0.5 shrink-0 text-brand-500" />
              {need}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export const Documents = () => (
  <Placeholder
    title="Documentos"
    icon="file"
    description="Acá van a estar la tarjeta de circulación, el seguro y los permisos de tu unidad."
    needs={[
      'Definir qué documentos se guardan por unidad y por chofer',
      'Una tabla de documentos con vencimientos y archivo adjunto',
      'Decidir si el chofer sólo los consulta o también los sube',
    ]}
  />
)

export const ServiceHistory = () => (
  <Placeholder
    title="Historial de Servicios"
    icon="wrench"
    description="El historial de mantenimientos y servicios de la unidad asignada."
    needs={[
      'Una tabla de servicios ligada a `vehicles`',
      'Definir si los carga el taller, el chofer o un administrador',
      'Conectar los "No OK" del check list para que abran un servicio',
    ]}
  />
)
