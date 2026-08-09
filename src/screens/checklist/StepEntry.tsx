import { useEffect, useState } from 'react'
import { Field, Input, SectionTitle, Select } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { clockTime, parseNumber, shortDate } from '@/lib/format'
import type { ChecklistDraft } from '@/lib/offline'
import type { Bodega } from '@/lib/database.types'
import { WizardFooter } from './ChecklistWizard'

export function StepEntry({
  draft,
  patch,
  onNext,
}: {
  draft: ChecklistDraft
  patch: (changes: Partial<ChecklistDraft>) => void
  onNext: () => void
}) {
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    void supabase
      .from('bodegas')
      .select('*')
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => setBodegas(data ?? []))
  }, [])

  const odometerError =
    touched && draft.odometerStart == null ? 'Ingresá el kilometraje inicial.' : null

  return (
    <>
      <div className="space-y-4 p-4">
        <SectionTitle hint="Registra la información al iniciar tu turno.">
          Registro de Entrada
        </SectionTitle>

        <Field label="Fecha">
          <Input icon="calendar" readOnly value={shortDate(draft.checklistDate)} />
        </Field>

        <Field label="Hora de entrada">
          <Input icon="clock" readOnly value={clockTime(draft.entryAt)} />
        </Field>

        <Field label="Kilometraje inicial" error={odometerError}>
          <Input
            icon="gauge"
            suffix="km"
            type="text"
            inputMode="numeric"
            placeholder="45230"
            invalid={Boolean(odometerError)}
            value={draft.odometerStart ?? ''}
            onChange={(event) => patch({ odometerStart: parseNumber(event.target.value) })}
          />
        </Field>

        <Field label="Base / Centro">
          <Select
            value={draft.depotId ?? ''}
            onChange={(value) => patch({ depotId: value || null })}
            placeholder="Seleccioná una base"
            options={bodegas.map((bodega) => ({ value: bodega.id, label: bodega.nombre }))}
          />
        </Field>
      </div>

      <WizardFooter
        onNext={() => {
          setTouched(true)
          if (draft.odometerStart != null) onNext()
        }}
      />
    </>
  )
}
