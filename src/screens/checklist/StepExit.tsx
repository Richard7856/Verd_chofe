import { useEffect, useState } from 'react'
import { Field, Input, SectionTitle, TextArea } from '@/components/ui'
import { NumberField } from '@/components/NumberField'
import { PhotoSlot } from '@/components/PhotoSlot'
import { Icon } from '@/components/Icons'
import { clockTime, km } from '@/lib/format'
import { currentCoords } from '@/lib/capture'
import type { CatalogoFoto } from '@/lib/database.types'
import type { ChecklistDraft, StoredPhoto } from '@/lib/offline'
import { WizardFooter } from './WizardFooter'

export function StepExit({
  draft,
  patch,
  onNext,
  slots,
  photoByCode,
  onCapture,
  onClear,
}: {
  draft: ChecklistDraft
  patch: (changes: Partial<ChecklistDraft>) => void
  onNext: () => void
  slots: CatalogoFoto[]
  photoByCode: Map<string, StoredPhoto>
  onCapture: (codigo: string, etiqueta: string, blob: Blob) => Promise<void>
  onClear: (codigo: string) => Promise<void>
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

  const faltanFotos = slots.filter((s) => s.obligatoria && !photoByCode.has(s.codigo))
  const kmValido = end != null && (start == null || end >= start)

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
          <NumberField
            icon="gauge"
            suffix="km"
            placeholder="45678"
            invalid={Boolean(odometerError)}
            value={end}
            onChange={(value) => patch({ odometerEnd: value })}
          />
        </Field>

        {/*
          La foto va pegada al kilometraje final y no en un paso aparte: es la
          evidencia de ese número, y el recorrido del turno sale de restarlo
          contra el inicial. Separarlos invitaba a escribir uno y fotografiar
          otro momento.
        */}
        {slots.length > 0 && (
          <div>
            {/* Encabezado genérico: cada recuadro ya lleva su propia etiqueta
                debajo, y repetirla se leía como dos campos distintos. */}
            <p className="mb-1.5 text-sm font-medium text-ink">
              {slots.length === 1 ? 'Evidencia del kilometraje' : 'Fotos de cierre'}
            </p>
            <div className={slots.length === 1 ? 'max-w-[240px]' : 'grid grid-cols-2 gap-3'}>
              {slots.map((s) => (
                <PhotoSlot
                  key={s.codigo}
                  label={s.etiqueta}
                  required={s.obligatoria}
                  blob={photoByCode.get(s.codigo)?.blob ?? null}
                  onCapture={(blob) => onCapture(s.codigo, s.etiqueta, blob)}
                  onClear={() => void onClear(s.codigo)}
                />
              ))}
            </div>
            {touched && faltanFotos.length > 0 && (
              <p className="mt-2 flex items-center gap-2 text-sm text-[--color-danger]">
                <Icon name="alert" size={16} />
                Tomá la foto del tablero para respaldar el kilometraje.
              </p>
            )}
          </div>
        )}

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
          if (kmValido && faltanFotos.length === 0) onNext()
        }}
        hint={
          faltanFotos.length > 0 && kmValido
            ? 'Falta la foto del tablero'
            : undefined
        }
      />
    </>
  )
}
