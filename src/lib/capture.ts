import imageCompression from 'browser-image-compression'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'

/**
 * Captura de fotos. En el APK usa la cámara nativa; en la web cae al
 * `<input capture>`. En ambos casos la imagen se comprime antes de guardarla:
 * un check list son 9 fotos y el bucket topa en 10 MB por archivo — sin
 * comprimir, un turno serían ~40 MB por celular y por día.
 */

const COMPRESSION = {
  maxSizeMB: 0.6,
  maxWidthOrHeight: 1600,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
}

export const isNative = Capacitor.isNativePlatform()

export async function compress(file: Blob): Promise<Blob> {
  const asFile = file instanceof File ? file : new File([file], 'foto.jpg', { type: file.type })
  try {
    return await imageCompression(asFile, COMPRESSION)
  } catch {
    // Si la compresión falla, es preferible subir el original que perder la evidencia.
    return file
  }
}

export async function takePhotoNative(): Promise<Blob | null> {
  const photo = await Camera.getPhoto({
    quality: 80,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    correctOrientation: true,
  })

  if (!photo.webPath) return null
  const response = await fetch(photo.webPath)
  return compress(await response.blob())
}

export async function pickPhotoNative(): Promise<Blob | null> {
  const photo = await Camera.getPhoto({
    quality: 80,
    resultType: CameraResultType.Uri,
    source: CameraSource.Photos,
    correctOrientation: true,
  })

  if (!photo.webPath) return null
  const response = await fetch(photo.webPath)
  return compress(await response.blob())
}

export interface Coords {
  lat: number | null
  lng: number | null
}

/**
 * La ubicación es un dato de respaldo, no un requisito: si el chofer negó el
 * permiso o está bajo techo, el check list se guarda igual.
 */
export async function currentCoords(timeoutMs = 8000): Promise<Coords> {
  try {
    if (isNative) {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: timeoutMs,
      })
      return { lat: position.coords.latitude, lng: position.coords.longitude }
    }

    return await new Promise<Coords>((resolve) => {
      if (!('geolocation' in navigator)) return resolve({ lat: null, lng: null })

      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
      )
    })
  } catch {
    return { lat: null, lng: null }
  }
}
