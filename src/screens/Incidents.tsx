import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Card, EmptyState, Field, SectionTitle, Select, Spinner, TextArea } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { currentCoords } from '@/lib/capture'
import { shortDate } from '@/lib/format'
import type { EstadoIncidencia, TipoIncidencia } from '@/lib/database.types'

const TIPOS: Array<{ value: TipoIncidencia; label: string }> = [
  { value: 'camino', label: 'En el camino' },
  { value: 'unidad', label: 'Con la unidad' },
  { value: 'entrega', label: 'En una entrega' },
  { value: 'otro', label: 'Otro' },
]

const ESTADOS: Record<EstadoIncidencia, { label: string; tone: 'warn' | 'success' | 'neutral' }> = {
  abierta: { label: 'Abierta', tone: 'warn' },
  vista: { label: 'Vista', tone: 'neutral' },
  resuelta: { label: 'Resuelta', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'neutral' },
}

interface Fila {
  id: string
  tipo: TipoIncidencia
  descripcion: string
  estado: EstadoIncidencia
  created_at: string
}

export function Incidents() {
  const { chofer, unidad } = useAuth()
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [redactando, setRedactando] = useState(false)
  const [tipo, setTipo] = useState<TipoIncidencia>('camino')
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    if (!chofer) return
    const { data } = await supabase
      .from('incidencias_chofer')
      .select('id, tipo, descripcion, estado, created_at')
      .eq('chofer_id', chofer.id)
      .order('created_at', { ascending: false })
      .limit(30)

    setFilas((data ?? []) as Fila[])
    setLoading(false)
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chofer])

  // La tabla exige entre 5 y 2000 caracteres en `descripcion`.
  const muyCorta = descripcion.trim().length < 5

  async function enviar() {
    if (!chofer || muyCorta) return
    setGuardando(true)
    setError(null)

    try {
      const coords = await currentCoords(5000)
      const { error: insertError } = await supabase.from('incidencias_chofer').insert({
        empresa_id: chofer.empresa_id,
        chofer_id: chofer.id,
        unidad_id: unidad?.id ?? null,
        tipo,
        descripcion: descripcion.trim(),
        lat: coords.lat,
        lng: coords.lng,
      })

      if (insertError) throw insertError

      setDescripcion('')
      setRedactando(false)
      await cargar()
    } catch (err) {
      setError(
        err instanceof Error
          ? `No se pudo enviar: ${err.message}`
          : 'No se pudo enviar la incidencia.',
      )
    } finally {
      setGuardando(false)
    }
  }

  if (redactando) {
    return (
      <div className="space-y-4 p-4">
        <SectionTitle hint="Contale a tu supervisor qué pasó.">Nueva incidencia</SectionTitle>

        <Field label="¿Dónde ocurrió?">
          <Select
            value={tipo}
            onChange={(value) => setTipo(value as TipoIncidencia)}
            options={TIPOS}
          />
        </Field>

        <Field
          label="Descripción"
          hint={`${descripcion.trim().length} / 2000 caracteres`}
          error={muyCorta && descripcion.length > 0 ? 'Escribí al menos 5 caracteres.' : null}
        >
          <TextArea
            rows={6}
            maxLength={2000}
            placeholder="Describí lo que pasó…"
            value={descripcion}
            onChange={(event) => setDescripcion(event.target.value)}
          />
        </Field>

        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-[--color-danger]">
            <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="space-y-2">
          <Button loading={guardando} disabled={muyCorta} onClick={() => void enviar()}>
            Enviar incidencia
          </Button>
          <Button variant="ghost" onClick={() => setRedactando(false)}>
            Cancelar
          </Button>
        </div>

        <p className="text-center text-xs text-body-soft">
          Las incidencias se envían al momento y necesitan conexión.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold text-ink">Incidencias</h1>
        <button
          type="button"
          onClick={() => setRedactando(true)}
          className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white active:bg-brand-600"
        >
          <Icon name="plus" size={16} />
          Nueva
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : filas.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="alert"
            title="Sin incidencias"
            description="Cuando reportes algo va a aparecer acá con su estado."
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {filas.map((fila) => {
            const estado = ESTADOS[fila.estado] ?? { label: fila.estado, tone: 'neutral' as const }
            const tipoLabel = TIPOS.find((t) => t.value === fila.tipo)?.label ?? fila.tipo

            return (
              <li key={fila.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">{tipoLabel}</p>
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                  </div>
                  <p className="mt-1.5 text-sm text-body">{fila.descripcion}</p>
                  <p className="mt-2 text-xs text-body-soft">{shortDate(fila.created_at)}</p>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
