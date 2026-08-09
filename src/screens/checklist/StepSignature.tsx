import { useCallback } from 'react'
import { SectionTitle } from '@/components/ui'
import { SignatureField } from '@/components/SignatureField'
import { Icon } from '@/components/Icons'
import type { ChecklistDraft } from '@/lib/offline'
import { WizardFooter } from './ChecklistWizard'

export function StepSignature({
  draft,
  patch,
  submitting,
  onSubmit,
}: {
  draft: ChecklistDraft
  patch: (changes: Partial<ChecklistDraft>) => void
  submitting: boolean
  onSubmit: () => void
}) {
  const handleChange = useCallback(
    (blob: Blob | null) => {
      patch({ signature: blob, signedAt: blob ? new Date().toISOString() : null })
    },
    [patch],
  )

  return (
    <>
      <div className="space-y-4 p-4">
        <SectionTitle hint="Al firmar, confirmás que la información registrada es correcta.">
          Firma de Conformidad
        </SectionTitle>

        <SignatureField onChange={handleChange} initial={draft.signature} />

        <div className="flex gap-2.5 rounded-xl bg-brand-50 p-3.5">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-brand-600" />
          <div className="text-sm">
            <p className="font-semibold text-brand-700">Importante</p>
            <p className="text-body">
              Asegurate de revisar toda la información antes de enviar. Una vez enviado, el
              check list no se puede editar.
            </p>
          </div>
        </div>
      </div>

      <WizardFooter
        onNext={onSubmit}
        label="Enviar check list"
        variant="success"
        loading={submitting}
        disabled={!draft.signature}
        hint={!draft.signature ? 'Necesitás firmar para poder enviar' : undefined}
      />
    </>
  )
}
