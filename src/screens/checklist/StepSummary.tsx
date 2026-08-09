import { Card, SectionTitle, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { clockTime, km, shortDate } from '@/lib/format'
import type { CatalogoItem, CatalogoFoto } from '@/lib/database.types'
import type { ChecklistDraft } from '@/lib/offline'
import { WizardFooter } from './ChecklistWizard'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-body-soft">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

export function StepSummary({
  draft,
  items,
  slots,
  photoCount,
  onNext,
  onEdit,
}: {
  draft: ChecklistDraft
  items: CatalogoItem[]
  slots: CatalogoFoto[]
  photoCount: number
  onNext: () => void
  onEdit: (step: number) => void
}) {
  const answers = Object.values(draft.items)
  const okCount = answers.filter((a) => a.status === 'ok').length
  const failures = items.filter((item) => draft.items[item.codigo]?.status === 'no_ok')
  const photosOk = photoCount >= slots.filter((s) => s.obligatoria).length

  return (
    <>
      <div className="space-y-3 p-4">
        <SectionTitle hint="Verificá la información antes de finalizar.">
          Resumen del Registro
        </SectionTitle>

        <Card>
          <div className="mb-1 flex items-center justify-between">
            <p className="font-bold text-brand-600">Entrada</p>
            <button
              type="button"
              onClick={() => onEdit(0)}
              className="flex items-center gap-1 text-xs font-semibold text-brand-500"
            >
              <Icon name="edit" size={13} /> Editar
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            <Row label="Fecha" value={shortDate(draft.checklistDate)} />
            <Row label="Hora entrada" value={clockTime(draft.entryAt)} />
            <Row label="Km inicial" value={km(draft.odometerStart)} />
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center justify-between">
            <p className="font-bold text-brand-600">Salida</p>
            <button
              type="button"
              onClick={() => onEdit(3)}
              className="flex items-center gap-1 text-xs font-semibold text-brand-500"
            >
              <Icon name="edit" size={13} /> Editar
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            <Row label="Hora salida" value={clockTime(draft.exitAt)} />
            <Row label="Km final" value={km(draft.odometerEnd)} />
            <Row label="Ruta" value={draft.shiftLabel || '—'} />
          </div>
        </Card>

        <Card>
          <p className="mb-1 font-bold text-brand-600">Resumen del Check List</p>
          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-body-soft">Condiciones</span>
              <span className="flex items-center gap-1.5 font-medium text-ink">
                {okCount}/{items.length} OK
                <Icon
                  name={failures.length === 0 ? 'checkCircle' : 'alert'}
                  size={16}
                  className={failures.length === 0 ? 'text-brand-500' : 'text-accent-600'}
                />
              </span>
            </div>

            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-body-soft">Fotos</span>
              <span className="flex items-center gap-1.5 font-medium text-ink">
                {photoCount}/{slots.length}
                <Icon
                  name={photosOk ? 'checkCircle' : 'alert'}
                  size={16}
                  className={photosOk ? 'text-brand-500' : 'text-accent-600'}
                />
              </span>
            </div>

            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-body-soft">Observaciones</span>
              <span className="font-medium text-ink">{draft.observations ? 1 : 0}</span>
            </div>
          </div>
        </Card>

        {/* Lo que está mal es lo que de verdad importa en este resumen. */}
        {failures.length > 0 && (
          <Card className={cx('border border-accent-400/40 bg-orange-50/50')}>
            <p className="mb-2 flex items-center gap-2 font-bold text-accent-600">
              <Icon name="alert" size={17} />
              {failures.length} punto{failures.length === 1 ? '' : 's'} con novedad
            </p>
            <ul className="space-y-1.5">
              {failures.map((item) => (
                <li key={item.codigo} className="text-sm">
                  <span className="font-medium text-ink">{item.etiqueta}</span>
                  {draft.items[item.codigo]?.note && (
                    <span className="block text-body-soft">{draft.items[item.codigo]?.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <WizardFooter onNext={onNext} />
    </>
  )
}
