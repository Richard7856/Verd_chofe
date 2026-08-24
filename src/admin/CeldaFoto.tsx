import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icons'

/**
 * Miniatura de una evidencia (ticket, foto) dentro de una tabla del panel.
 *
 * Al tocarla se abre a pantalla completa sin salir de la página: revisar
 * tickets es pasar por varios seguidos, y abrir una pestaña por cada uno no
 * sirve. Cuando la fila no tiene foto se muestra un guión, igual que el resto
 * de las celdas vacías.
 */
export function CeldaFoto({ url, titulo }: { url: string | null; titulo: string }) {
  const [abierta, setAbierta] = useState(false)

  if (!url) return <span className="text-body-soft">—</span>

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        title="Ver foto"
        className="block overflow-hidden rounded-md border border-gray-200 transition-opacity hover:opacity-80"
      >
        <img src={url} alt={titulo} loading="lazy" className="h-10 w-14 object-cover" />
      </button>

      {abierta && <Visor url={url} titulo={titulo} onCerrar={() => setAbierta(false)} />}
    </>
  )
}

function Visor({ url, titulo, onCerrar }: { url: string; titulo: string; onCerrar: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCerrar])

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
        className="max-h-[85vh] max-w-full rounded-lg object-contain"
      />
      <p className="text-sm text-white/90">{titulo}</p>
    </div>
  )
}
