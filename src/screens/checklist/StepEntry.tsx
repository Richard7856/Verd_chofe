import { useEffect, useState } from 'react'
import { Field, Input, SectionTitle, Select } from '@/components/ui'
import { NumberField } from '@/components/NumberField'
import { Icon } from '@/components/Icons'
import { supabase } from '@/lib/supabase'
import { clockTime, shortDate } from '@/lib/format'
import type { ChecklistDraft } from '@/lib/offline'
import type { Bodega, Unidad } from '@/lib/database.types'
import { WizardFooter } from './WizardFooter'

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
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    void Promise.all([
      supabase.from('bodegas').select('*').eq('activo', true).order('nombre'),
      supabase.from('unidades').select('*').eq('activo', true).order('placa'),
    ]).then(([b, u]) => {
      setBodegas(b.data ?? [])
      setUnidades(u.data ?? [])
    })
  }, [])

  const errorUnidad = touched && !draft.vehicleId ? 'Elegí con qué unidad vas a salir.' : null
  const errorKm =
    touched && draft.odometerStart == null ? 'Ingresá el kilometraje inicial.' : null

  const listo = Boolean(draft.vehicleId) && draft.odometerStart != null

  return (
    <>
      <div className="space-y-4 p-4">
        <SectionTitle hint="Registra la información al iniciar tu turno.">
          Registro de Entrada
        </SectionTitle>

        {/*
          La unidad se elige acá y no en otra pantalla a propósito. Antes se
          tomaba de la unidad asignada al chofer, que podía estar vacía sin que
          nada lo advirtiera: el chofer llenaba el check list completo, con
          fotos, y el envío moría después porque no había unidad. Siendo un
          campo obligatorio del formulario, esa situación no puede darse.
        */}
        <Field label="Unidad" error={errorUnidad}>
          <Select
            invalid={Boolean(errorUnidad)}
            value={draft.vehicleId ?? ''}
            onChange={(value) => patch({ vehicleId: value || null })}
            placeholder="Seleccioná tu unidad"
            options={unidades.map((u) => ({
              value: u.id,
              label: `${u.placa} · ${[u.marca, u.modelo].filter(Boolean).join(' ') || u.alias || 'Unidad'}`,
            }))}
          />
        </Field>

        {unidades.length === 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-orange-50 px-3.5 py-3 text-sm text-accent-600">
            <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
            No hay unidades dadas de alta para tu empresa. Avisale a tu supervisor: sin unidad no
            se puede abrir el turno.
          </p>
        )}

        <Field label="Fecha">
          <Input icon="calendar" readOnly value={shortDate(draft.checklistDate)} />
        </Field>

        <Field label="Hora de entrada">
          <Input icon="clock" readOnly value={clockTime(draft.entryAt)} />
        </Field>

        <Field label="Kilometraje inicial" error={errorKm}>
          <NumberField
            icon="gauge"
            suffix="km"
            placeholder="45230"
            invalid={Boolean(errorKm)}
            value={draft.odometerStart}
            onChange={(value) => patch({ odometerStart: value })}
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
          if (listo) onNext()
        }}
      />
    </>
  )
}
