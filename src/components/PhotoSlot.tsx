import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'
import { cx } from './ui'
import { compress, isNative, takePhotoNative } from '@/lib/capture'

/**
 * Un recuadro de evidencia fotográfica. En el APK abre la cámara nativa;
 * en la web usa `<input capture="environment">`, que en Android/iOS abre
 * la cámara trasera directamente.
 */
export function PhotoSlot({
  label,
  blob,
  onCapture,
  onClear,
  required = true,
}: {
  label: string
  blob: Blob | null
  onCapture: (blob: Blob) => void | Promise<void>
  onClear?: () => void
  required?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!blob) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  async function handleClick() {
    if (busy) return

    if (isNative) {
      setBusy(true)
      try {
        const photo = await takePhotoNative()
        if (photo) await onCapture(photo)
      } finally {
        setBusy(false)
      }
      return
    }

    inputRef.current?.click()
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      await onCapture(await compress(file))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        aria-label={preview ? `Cambiar foto: ${label}` : `Tomar foto: ${label}`}
        className={cx(
          'flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed p-3 transition-colors',
          preview ? 'border-brand-300 bg-brand-50/40' : 'border-gray-200 bg-white active:bg-gray-50',
          'aspect-[4/3]',
        )}
      >
        {preview ? (
          <img src={preview} alt={label} className="h-full w-full rounded-lg object-cover" />
        ) : busy ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
        ) : (
          <>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <Icon name="camera" size={20} />
            </span>
            <span className="text-xs font-medium text-brand-600">Tomar foto</span>
          </>
        )}
      </button>

      <div className="mt-1.5 flex items-start justify-between gap-1">
        <p className="text-xs leading-tight text-body">
          {label}
          {required && !preview && <span className="text-[--color-danger]"> *</span>}
        </p>
        {preview && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Quitar foto: ${label}`}
            className="shrink-0 text-body-soft active:text-[--color-danger]"
          >
            <Icon name="x" size={15} />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
    </div>
  )
}
