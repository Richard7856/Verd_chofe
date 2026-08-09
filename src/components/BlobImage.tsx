import { useEffect, useState } from 'react'

/**
 * Muestra un Blob como imagen liberando la object URL al desmontar.
 * Hacer `URL.createObjectURL` directo en el render filtra memoria: cada
 * re-render crea una URL nueva que nunca se revoca.
 */
export function BlobImage({
  blob,
  alt,
  className,
}: {
  blob: Blob | null
  alt: string
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null
  return <img src={url} alt={alt} className={className} />
}
