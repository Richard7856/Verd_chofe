import { useCallback, useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import { Icon } from './Icons'

/**
 * Firma de conformidad. El canvas se dibuja a la resolución real del
 * dispositivo (devicePixelRatio); si no, en un celular la firma sale pixelada
 * y desalineada respecto del dedo.
 */
export function SignatureField({
  onChange,
  initial,
}: {
  onChange: (blob: Blob | null) => void
  initial?: Blob | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const [empty, setEmpty] = useState(!initial)

  const emit = useCallback(() => {
    const pad = padRef.current
    if (!pad || pad.isEmpty()) {
      setEmpty(true)
      onChange(null)
      return
    }
    setEmpty(false)
    canvasRef.current?.toBlob((blob) => onChange(blob), 'image/png')
  }, [onChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const data = padRef.current?.toData()

      canvas.width = canvas.offsetWidth * ratio
      canvas.height = canvas.offsetHeight * ratio
      canvas.getContext('2d')?.scale(ratio, ratio)

      if (data?.length) padRef.current?.fromData(data)
    }

    const pad = new SignaturePad(canvas, {
      penColor: '#1f2937',
      backgroundColor: 'rgba(255,255,255,0)',
      minWidth: 1,
      maxWidth: 2.6,
    })
    padRef.current = pad
    resize()

    pad.addEventListener('endStroke', emit)
    window.addEventListener('resize', resize)

    if (initial) {
      const url = URL.createObjectURL(initial)
      pad.fromDataURL(url)
      setEmpty(false)
      URL.revokeObjectURL(url)
    }

    return () => {
      pad.removeEventListener('endStroke', emit)
      window.removeEventListener('resize', resize)
      pad.off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clear() {
    padRef.current?.clear()
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <div className="rounded-2xl border border-gray-200 bg-white p-2">
        <canvas
          ref={canvasRef}
          className="h-52 w-full touch-none rounded-xl"
          aria-label="Área de firma"
        />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 text-sm text-body-soft active:text-ink"
        >
          <Icon name="eraser" size={16} />
          Limpiar firma
        </button>
        {empty && <span className="text-xs text-body-soft">Firmá dentro del recuadro</span>}
      </div>
    </div>
  )
}
