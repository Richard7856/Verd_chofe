import { useMemo, useState } from 'react'
import { Card, SectionTitle, TextArea, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import type { CatalogoItem, EstadoItem } from '@/lib/database.types'
import type { ChecklistDraft } from '@/lib/offline'
import { WizardFooter } from './ChecklistWizard'

const OPTIONS: Array<{ value: EstadoItem; label: string; dot: string; active: string }> = [
  { value: 'ok', label: 'OK', dot: 'bg-brand-500', active: 'border-brand-500 bg-brand-50' },
  { value: 'no_ok', label: 'No OK', dot: 'bg-accent-500', active: 'border-accent-500 bg-orange-50' },
  { value: 'na', label: 'N/A', dot: 'bg-gray-400', active: 'border-gray-400 bg-gray-50' },
]

export function StepConditions({
  draft,
  items,
  patch,
  onNext,
}: {
  draft: ChecklistDraft
  items: CatalogoItem[]
  patch: (changes: Partial<ChecklistDraft>) => void
  onNext: () => void
}) {
  const [showErrors, setShowErrors] = useState(false)

  const answered = useMemo(
    () => items.filter((item) => draft.items[item.codigo]).length,
    [items, draft.items],
  )
  const complete = answered === items.length

  // Se guarda también la etiqueta: el catálogo puede editarse después y el
  // registro histórico tiene que seguir diciendo lo que el chofer leyó.
  function setStatus(codigo: string, etiqueta: string, status: EstadoItem) {
    patch({
      items: { ...draft.items, [codigo]: { ...draft.items[codigo], status, label: etiqueta } },
    })
  }

  function setNote(code: string, note: string) {
    const existing = draft.items[code]
    if (!existing) return
    patch({ items: { ...draft.items, [code]: { ...existing, note } } })
  }

  return (
    <>
      <div className="space-y-3 p-4">
        <SectionTitle hint="Revisá cada punto y seleccioná el estado.">
          Checklist de Condiciones
        </SectionTitle>

        <div className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm shadow-sm">
          <span className="text-body">Respondidos</span>
          <span className={cx('font-bold', complete ? 'text-brand-600' : 'text-accent-600')}>
            {answered} / {items.length}
          </span>
        </div>

        <Card padded={false} className="divide-y divide-gray-100">
          {items.map((item) => {
            const current = draft.items[item.codigo]
            const missing = showErrors && !current

            return (
              <div key={item.codigo} className={cx('p-3.5', missing && 'bg-red-50/50')}>
                <p className="mb-2.5 text-sm leading-snug text-ink">{item.etiqueta}</p>

                <div className="grid grid-cols-3 gap-2">
                  {OPTIONS.map((option) => {
                    const selected = current?.status === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatus(item.codigo, item.etiqueta, option.value)}
                        aria-pressed={selected}
                        className={cx(
                          'flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[13px] font-semibold transition-colors tap-target',
                          selected ? option.active : 'border-gray-200 bg-white text-body-soft',
                        )}
                      >
                        <span className={cx('h-2 w-2 rounded-full', selected ? option.dot : 'bg-gray-300')} />
                        {option.label}
                      </button>
                    )
                  })}
                </div>

                {/* Si algo está mal, el detalle es lo que el taller necesita. */}
                {current?.status === 'no_ok' && (
                  <TextArea
                    rows={2}
                    className="mt-2.5 text-sm"
                    placeholder="¿Qué encontraste? (obligatorio)"
                    value={current.note ?? ''}
                    onChange={(event) => setNote(item.codigo, event.target.value)}
                  />
                )}
              </div>
            )
          })}
        </Card>

        {showErrors && !complete && (
          <p className="flex items-center gap-2 text-sm text-[--color-danger]">
            <Icon name="alert" size={16} />
            Faltan {items.length - answered} punto{items.length - answered === 1 ? '' : 's'} por revisar.
          </p>
        )}
      </div>

      <WizardFooter
        onNext={() => {
          setShowErrors(true)
          if (complete) onNext()
        }}
        disabled={false}
      />
    </>
  )
}
