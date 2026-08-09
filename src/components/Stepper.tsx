import { cx } from './ui'
import { Icon } from './Icons'

/**
 * El mockup mostraba "Paso 1 de 7" con sólo 5 burbujas y etiquetas que se
 * corrían entre pantallas. Acá los 7 pasos son explícitos y la fila hace
 * scroll horizontal en pantallas angostas, que es lo que el diseño intentaba.
 */
export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: string[]
  current: number
  onSelect?: (index: number) => void
}) {
  return (
    <nav aria-label="Progreso" className="border-b border-gray-100 bg-white">
      <p className="pt-2 text-center text-sm text-body-soft">
        Paso {current + 1} de {steps.length}
      </p>

      <ol className="flex snap-x gap-1 overflow-x-auto px-3 pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((label, index) => {
          const done = index < current
          const active = index === current
          const reachable = onSelect && index < current

          return (
            <li key={label} className="flex min-w-[64px] shrink-0 snap-start flex-col items-center gap-1.5">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && onSelect(index)}
                aria-current={active ? 'step' : undefined}
                className={cx(
                  'flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold transition-colors',
                  active && 'bg-brand-500 text-white',
                  done && 'bg-brand-100 text-brand-600',
                  !active && !done && 'bg-gray-100 text-gray-400',
                  reachable && 'cursor-pointer',
                )}
              >
                {done ? <Icon name="check" size={15} /> : index + 1}
              </button>
              <span
                className={cx(
                  'text-center text-[11px] leading-tight',
                  active ? 'font-semibold text-brand-600' : 'text-body-soft',
                )}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
