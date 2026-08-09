import { Button } from '@/components/ui'

/** Barra de acción fija al pie, común a los pasos de apertura y cierre. */
export function WizardFooter({
  onNext,
  label = 'Siguiente',
  disabled,
  loading,
  hint,
  variant = 'primary',
}: {
  onNext: () => void
  label?: string
  disabled?: boolean
  loading?: boolean
  hint?: string
  variant?: 'primary' | 'success'
}) {
  return (
    <div className="safe-bottom sticky bottom-0 border-t border-gray-100 bg-white px-4 py-3">
      {hint && <p className="mb-2 text-center text-xs text-body-soft">{hint}</p>}
      <Button onClick={onNext} disabled={disabled} loading={loading} variant={variant}>
        {label}
      </Button>
    </div>
  )
}
