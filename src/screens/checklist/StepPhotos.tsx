import { useState } from 'react'
import { PhotoSlot } from '@/components/PhotoSlot'
import { SectionTitle, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import type { CatalogoFoto } from '@/lib/database.types'
import type { StoredPhoto } from '@/lib/offline'
import { WizardFooter } from './WizardFooter'

export function StepPhotos({
  slots,
  photoByCode,
  onCapture,
  onClear,
  onNext,
  labelFinal = 'Siguiente',
  enviando = false,
}: {
  slots: CatalogoFoto[]
  photoByCode: Map<string, StoredPhoto>
  onCapture: (slotCode: string, label: string, blob: Blob) => Promise<void>
  onClear: (slotCode: string) => Promise<void>
  onNext: () => void
  labelFinal?: string
  enviando?: boolean
}) {
  const [showErrors, setShowErrors] = useState(false)

  const required = slots.filter((slot) => slot.obligatoria)
  const missing = required.filter((slot) => !photoByCode.has(slot.codigo))
  const taken = slots.filter((slot) => photoByCode.has(slot.codigo)).length

  return (
    <>
      <div className="space-y-3 p-4">
        <SectionTitle hint="Tomá todas las fotos solicitadas.">Evidencia Fotográfica</SectionTitle>

        <div className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm shadow-sm">
          <span className="text-body">Fotos tomadas</span>
          <span className={cx('font-bold', missing.length === 0 ? 'text-brand-600' : 'text-accent-600')}>
            {taken} / {slots.length}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {slots.map((slot) => (
            <PhotoSlot
              key={slot.codigo}
              label={slot.etiqueta}
              required={slot.obligatoria}
              blob={photoByCode.get(slot.codigo)?.blob ?? null}
              onCapture={(blob) => onCapture(slot.codigo, slot.etiqueta, blob)}
              onClear={() => void onClear(slot.codigo)}
            />
          ))}
        </div>

        {showErrors && missing.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-[--color-danger]">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            Faltan {missing.length} foto{missing.length === 1 ? '' : 's'}: {missing.map((s) => s.etiqueta).join(', ')}.
          </p>
        )}
      </div>

      <WizardFooter
        label={labelFinal}
        loading={enviando}
        variant={labelFinal === 'Siguiente' ? 'primary' : 'success'}
        onNext={() => {
          setShowErrors(true)
          if (missing.length === 0) onNext()
        }}
        hint={
          missing.length > 0
            ? `${missing.length} foto${missing.length === 1 ? '' : 's'} obligatoria${missing.length === 1 ? '' : 's'} pendiente${missing.length === 1 ? '' : 's'}`
            : undefined
        }
      />
    </>
  )
}
