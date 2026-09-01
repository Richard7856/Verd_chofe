import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { BUCKET_EVIDENCIAS, supabase } from '@/lib/supabase'
import { PhotoSlot } from '@/components/PhotoSlot'
import { Badge, Card, EmptyState, SectionTitle, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { shortDate } from '@/lib/format'
import type { RevisionFoto } from '@/lib/database.types'

const ORIGEN: Record<RevisionFoto['origen'], string> = {
  checklist: 'Check list de unidad',
  combustible: 'Carga de combustible',
  gasto: 'Gasto extra',
}

/**
 * Fotos que el supervisor rechazó y hay que volver a tomar.
 *
 * La nueva foto se sube sobre la MISMA ruta del bucket, así que el registro
 * original (check list, carga o gasto) no cambia: sólo la imagen. Va directo,
 * sin cola offline: esto se hace después, revisando el teléfono con señal —
 * y si falla, la foto simplemente sigue pendiente.
 */
export function ResubirFotos() {
  const { chofer } = useAuth()
  const [pendientes, setPendientes] = useState<RevisionFoto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [blobs, setBlobs] = useState<Record<string, Blob>>({})
  const [enviadas, setEnviadas] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!chofer) return
    async function cargar() {
      const { data } = await supabase
        .from('revisiones_foto')
        .select('*')
        .eq('chofer_id', chofer!.id)
        .eq('estado', 'rechazada')
        .order('revisada_el', { ascending: false })
      setPendientes((data ?? []) as RevisionFoto[])
      setCargando(false)
    }
    void cargar()
  }, [chofer])

  async function resubir(revision: RevisionFoto, blob: Blob) {
    setError(null)
    setBlobs((prev) => ({ ...prev, [revision.id]: blob }))

    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_EVIDENCIAS)
        .upload(revision.ruta, blob, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) throw new Error(uploadError.message)

      const { error: updateError } = await supabase
        .from('revisiones_foto')
        .update({ estado: 'resubida', resubida_el: new Date().toISOString() })
        .eq('id', revision.id)
      if (updateError) throw new Error(updateError.message)

      setEnviadas((prev) => new Set(prev).add(revision.id))
    } catch {
      setError('No se pudo subir la foto. Revisá tu señal e intentá de nuevo.')
    }
  }

  if (cargando) return <Spinner label="Buscando fotos pendientes…" />

  return (
    <div className="space-y-4 p-4">
      <SectionTitle hint="Tu supervisor rechazó estas fotos. Tomalas de nuevo y se envían al instante.">
        Fotos por resubir
      </SectionTitle>

      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {pendientes.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="checkCircle"
            title="No tenés fotos pendientes"
            description="Cuando el supervisor rechace una foto, va a aparecer acá para volver a tomarla."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {pendientes.map((p) => {
            const enviada = enviadas.has(p.id)
            return (
              <li key={p.id}>
                <Card>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-bold text-ink">{p.etiqueta}</p>
                    {enviada ? (
                      <Badge tone="success">Enviada</Badge>
                    ) : (
                      <Badge tone="warn">Pendiente</Badge>
                    )}
                  </div>
                  <p className="text-xs text-body-soft">
                    {ORIGEN[p.origen]} · rechazada el {shortDate(p.revisada_el)}
                  </p>
                  {p.motivo && (
                    <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-accent-600">
                      Motivo: {p.motivo}
                    </p>
                  )}

                  {enviada ? (
                    <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-brand-600">
                      <Icon name="checkCircle" size={17} />
                      Foto enviada, queda en revisión.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <PhotoSlot
                        label="Tomá la foto de nuevo"
                        blob={blobs[p.id] ?? null}
                        onCapture={(blob) => resubir(p, blob)}
                      />
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
