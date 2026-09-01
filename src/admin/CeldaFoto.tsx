import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui'
import { Icon } from '@/components/Icons'
import type { RevisionFoto } from '@/lib/database.types'

/**
 * Miniatura de una evidencia (ticket, foto) dentro de una tabla del panel.
 *
 * Al tocarla se abre a pantalla completa sin salir de la página: revisar
 * tickets es pasar por varios seguidos, y abrir una pestaña por cada uno no
 * sirve. Si se pasan `onAprobar`/`onRechazar`, el visor muestra los botones
 * de revisión.
 *
 * Una foto rechazada ya no existe en el bucket (se borra al rechazarla), así
 * que la celda muestra la etiqueta "Rechazada" en su lugar hasta que el
 * chofer la re-suba.
 */
export function CeldaFoto({
  url,
  titulo,
  revision,
  onAprobar,
  onRechazar,
}: {
  url: string | null
  titulo: string
  revision?: RevisionFoto | null
  onAprobar?: () => void | Promise<void>
  onRechazar?: (motivo: string) => void | Promise<void>
}) {
  const [abierta, setAbierta] = useState(false)

  if (!url) {
    if (revision?.estado === 'rechazada') {
      return (
        <span title={revision.motivo ?? undefined}>
          <Badge tone="warn">Rechazada</Badge>
        </span>
      )
    }
    return <span className="text-body-soft">—</span>
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        title="Ver foto"
        className="relative block overflow-hidden rounded-md border border-gray-200 transition-opacity hover:opacity-80"
      >
        <img src={url} alt={titulo} loading="lazy" className="h-10 w-14 object-cover" />
        {revision?.estado === 'aprobada' && (
          <span className="absolute bottom-0 right-0 rounded-tl-md bg-brand-500 p-0.5 text-white">
            <Icon name="check" size={11} />
          </span>
        )}
        {revision?.estado === 'resubida' && (
          <span className="absolute bottom-0 right-0 rounded-tl-md bg-accent-600 p-0.5 text-white">
            <Icon name="refresh" size={11} />
          </span>
        )}
      </button>

      {abierta && (
        <Visor
          url={url}
          titulo={titulo}
          revision={revision}
          onAprobar={onAprobar}
          onRechazar={onRechazar}
          onCerrar={() => setAbierta(false)}
        />
      )}
    </>
  )
}

/** Pide el motivo del rechazo. Devuelve null si el admin canceló. */
export function pedirMotivo(): string | null {
  const motivo = window.prompt(
    '¿Por qué se rechaza la foto? El chofer verá este motivo y la foto se eliminará para que suba una nueva.',
  )
  if (motivo == null) return null
  if (motivo.trim().length < 3) {
    window.alert('Escribí un motivo de al menos 3 letras: el chofer necesita saber qué corregir.')
    return null
  }
  return motivo.trim()
}

/** Etiqueta del estado de revisión, para mostrar junto a una foto. */
export function RevisionBadge({ revision }: { revision: RevisionFoto | null | undefined }) {
  if (!revision) return null
  if (revision.estado === 'aprobada') return <Badge tone="success">Aprobada</Badge>
  if (revision.estado === 'resubida') return <Badge tone="warn">Re-subida, por revisar</Badge>
  return (
    <span title={revision.motivo ?? undefined}>
      <Badge tone="warn">Rechazada</Badge>
    </span>
  )
}

export function Visor({
  url,
  titulo,
  revision,
  onAprobar,
  onRechazar,
  onCerrar,
}: {
  url: string
  titulo: string
  revision?: RevisionFoto | null
  onAprobar?: () => void | Promise<void>
  onRechazar?: (motivo: string) => void | Promise<void>
  onCerrar: () => void
}) {
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCerrar])

  async function aprobar() {
    if (!onAprobar || ocupado) return
    setOcupado(true)
    try {
      await onAprobar()
      onCerrar()
    } finally {
      setOcupado(false)
    }
  }

  async function rechazar() {
    if (!onRechazar || ocupado) return
    const motivo = pedirMotivo()
    if (!motivo) return
    setOcupado(true)
    try {
      await onRechazar(motivo)
      onCerrar()
    } finally {
      setOcupado(false)
    }
  }

  // Una foto ya aprobada aún puede rechazarse (clic equivocado); una
  // rechazada ya no está en el bucket, así que no llega hasta acá.
  const puedeAprobar = onAprobar && revision?.estado !== 'aprobada'

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
      onClick={onCerrar}
    >
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar"
        className="absolute right-4 top-4 text-white/80 hover:text-white"
      >
        <Icon name="x" size={26} />
      </button>

      {/* Tocar la imagen no cierra el visor; sólo el fondo o la ✕. */}
      <img
        src={url}
        alt={titulo}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[78vh] max-w-full rounded-lg object-contain"
      />
      <p className="text-sm text-white/90">{titulo}</p>

      {(puedeAprobar || onRechazar) && (
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          {revision?.estado === 'aprobada' && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-300">
              <Icon name="checkCircle" size={16} /> Aprobada
            </span>
          )}
          {puedeAprobar && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void aprobar()}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              <Icon name="check" size={16} /> Aprobar
            </button>
          )}
          {onRechazar && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void rechazar()}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-white/20 disabled:opacity-60"
            >
              <Icon name="x" size={16} /> Rechazar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
