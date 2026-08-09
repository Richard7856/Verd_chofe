import { useEffect, useState } from 'react'
import { Field, Input, SectionTitle, TextArea } from '@/components/ui'
import { clockTime, km, parseNumber } from '@/lib/format'
import { currentCoords } from '@/lib/capture'
import type { ChecklistDraft } from '@/lib/offline'
import { WizardFooter } from './ChecklistWizard'

export function StepExit({
  draft,
  patch,
  onNext,
}: {
  draft: ChecklistDraft
  patch: (changes: Partial<ChecklistDraft>) => void
  onNext: () => void
}) {
  const [touched, setTouched] = useState(false)

  // La hora de salida se sella al llegar a este paso, no al enviar el formulario.
  const sealed = Boolean(draft.exitAt)
  useEffect(() => {
    if (sealed) return
    void currentCoords(4000).then((coords) =>
      patch({ exitAt: new Date().toISOString(), exitLat: coords.lat, exitLng: coords.lng }),
    )
  }, [sealed, patch])

  const end = draft.odometerEnd
  const start = draft.odometerStart

  const odometerError = !touched
    ? null
    : end == null
      ? 'Ingresá el kilometraje final.'
      : start != null && end < start
        ? `No puede ser menor al inicial (${km(start)}).`
        : null

  const distance = start != null && end != null && end >= start ? end - start : null

  return (
    <>
      <div className="space-y-4 p-4">
        <SectionTitle hint="Registra la información al finalizar tu turno.">
          Registro de Salida
        </SectionTitle>

        <Field label="Hora de salida">
          <Input icon="clock" readOnly value={clockTime(draft.exitAt)} />
        </Field>

        <Field
          label="Kilometraje final"
          error={odometerError}
          hint={distance != null ? `Recorrido del turno: ${km(distance)}` : undefined}
        >
          <Input
            icon="gauge"
            suffix="km"
            type="text"
            inputMode="numeric"
            placeholder="45678"
            invalid={Boolean(odometerError)}
            value={end ?? ''}
            onChange={(event) => patch({ odometerEnd: parseNumber(event.target.value) })}
          />
        </Field>

        <Field label="Ruta / Turno">
          <Input
            icon="mapPin"
            placeholder="Sucursal Norte – Centro de Distribución"
            value={draft.shiftLabel ?? ''}
            onChange={(event) => patch({ shiftLabel: event.target.value || null })}
          />
        </Field>

        <Field label="Observaciones del turno">
          <TextArea
            rows={4}
            placeholder="Describí cualquier novedad del turno…"
            value={draft.observations ?? ''}
            onChange={(event) => patch({ observations: event.target.value || null })}
          />
        </Field>
      </div>

      <WizardFooter
        onNext={() => {
          setTouched(true)
          if (end != null && (start == null || end >= start)) onNext()
        }}
      />
    </>
  )
}
