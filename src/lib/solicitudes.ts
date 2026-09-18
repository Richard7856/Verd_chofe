import { supabase } from './supabase'
import type { SolicitudCombustible } from './database.types'

/**
 * Solicitudes de carga de combustible, del lado del chofer.
 *
 * El circuito es: el chofer pide, el admin autoriza, y recién entonces la app
 * le deja subir el ticket. Nada de esto funciona sin señal —a propósito—
 * porque una solicitud guardada en el teléfono sería un chofer esperando una
 * respuesta que nadie llegó a ver.
 */

/** Lo que bloquea pedir otra: sigue viva mientras no se resuelva o se cargue. */
export function estaAbierta(s: SolicitudCombustible) {
  return s.estado === 'pendiente' || s.estado === 'aprobada'
}

/**
 * La solicitud que la pantalla tiene que mostrar: la que está abierta, y si no
 * hay ninguna, la última resuelta —para que el chofer vea por qué se la
 * rechazaron en vez de que desaparezca sin explicación.
 */
export async function solicitudVigente(choferId: string): Promise<SolicitudCombustible | null> {
  const { data, error } = await supabase
    .from('solicitudes_combustible')
    .select('*')
    .eq('chofer_id', choferId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0] ?? null
}

export async function crearSolicitud(datos: {
  empresaId: string
  choferId: string
  unidadId: string
  checklistId: string | null
  litros: number | null
  montoEstimado: number | null
  estacion: string | null
  km: number | null
  motivo: string | null
  lat: number | null
  lng: number | null
}): Promise<SolicitudCombustible> {
  const { data, error } = await supabase
    .from('solicitudes_combustible')
    .insert({
      empresa_id: datos.empresaId,
      chofer_id: datos.choferId,
      unidad_id: datos.unidadId,
      checklist_id: datos.checklistId,
      litros: datos.litros,
      monto_estimado: datos.montoEstimado,
      estacion: datos.estacion,
      km: datos.km,
      motivo: datos.motivo,
      lat: datos.lat,
      lng: datos.lng,
    })
    .select('*')
    .single()

  // El índice parcial deja una sola solicitud viva por chofer. Que choque
  // quiere decir que ya hay una en curso —probablemente en otra pestaña o en
  // un toque doble—, no que haya un problema que el chofer pueda arreglar.
  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya tenés una solicitud en curso. Actualizá la pantalla para verla.')
    }
    throw error
  }

  return data
}

export async function cancelarSolicitud(id: string) {
  const { error } = await supabase.rpc('cancelar_solicitud_combustible' as never, {
    p_id: id,
  } as never)
  if (error) throw error
}
