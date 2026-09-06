import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Puente hacia la API de socios de TripDrive (rutas y kilómetros por día).
 *
 * Existe por la llave: `TRIPDRIVE_API_KEY` acota a un cliente entero, así que
 * no puede viajar en el bundle del panel — el navegador se descarga todo el
 * código y cualquiera la sacaría. Acá queda del lado del servidor y sólo
 * responde a administradores.
 *
 * No guarda nada: consulta y devuelve. Si más adelante hace falta histórico,
 * conviene una tabla propia y no depender de que la API responda siempre.
 */

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const API_URL = Deno.env.get('TRIPDRIVE_API_URL') ?? ''
const API_KEY = Deno.env.get('TRIPDRIVE_API_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** La API topa en 62 días; se valida acá para no gastar el viaje. */
const MAX_DIAS = 62

function diasEntre(desde: string, hasta: string): number {
  const ms = new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()
  return Math.floor(ms / 86_400_000) + 1
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)

  if (!API_URL || !API_KEY) {
    return responder(
      {
        error:
          'Falta configurar la conexión con TripDrive. Un administrador debe cargar ' +
          'TRIPDRIVE_API_URL y TRIPDRIVE_API_KEY en los secretos del proyecto.',
      },
      503,
    )
  }

  const autorizacion = req.headers.get('Authorization')
  if (!autorizacion) return responder({ error: 'Falta la sesión' }, 401)

  const comoUsuario = createClient(URL_SUPABASE, CLAVE_ANON, {
    global: { headers: { Authorization: autorizacion } },
  })
  const {
    data: { user },
  } = await comoUsuario.auth.getUser()
  if (!user) return responder({ error: 'Sesión inválida o vencida' }, 401)

  // El rol se lee con service_role: si dependiera de RLS y las políticas
  // cambiaran, esta verificación podría quedar sin efecto.
  const admin = createClient(URL_SUPABASE, CLAVE_SERVICIO)
  const { data: perfil } = await admin
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .maybeSingle()

  if (!perfil || perfil.rol !== 'admin') {
    return responder({ error: 'Sólo un administrador puede consultar las rutas' }, 403)
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await req.json()
  } catch {
    return responder({ error: 'Cuerpo inválido' }, 400)
  }

  const desde = String(cuerpo.desde ?? '')
  const hasta = String(cuerpo.hasta ?? '')
  const fecha = /^\d{4}-\d{2}-\d{2}$/

  if (!fecha.test(desde) || !fecha.test(hasta)) {
    return responder({ error: 'Fechas inválidas: se esperaba AAAA-MM-DD' }, 400)
  }
  if (desde > hasta) return responder({ error: 'La fecha inicial es posterior a la final' }, 400)
  if (diasEntre(desde, hasta) > MAX_DIAS) {
    return responder({ error: `El rango no puede pasar de ${MAX_DIAS} días` }, 400)
  }

  const url = new URL('/api/partners/routes', API_URL)
  url.searchParams.set('from', desde)
  url.searchParams.set('to', hasta)

  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    return responder({ error: 'TripDrive no respondió. Intentá de nuevo en un momento.' }, 504)
  }

  if (!respuesta.ok) {
    // Los códigos de la API traducidos a algo que el panel pueda mostrar.
    const porCodigo: Record<number, string> = {
      401: 'TripDrive rechazó la llave. Hay que revisar TRIPDRIVE_API_KEY.',
      400: 'TripDrive rechazó los parámetros de la consulta.',
      413: 'El rango trae demasiadas rutas. Acotá las fechas.',
      500: 'TripDrive tuvo un error interno. Intentá de nuevo.',
    }
    return responder(
      { error: porCodigo[respuesta.status] ?? `TripDrive respondió ${respuesta.status}` },
      respuesta.status === 401 ? 502 : respuesta.status,
    )
  }

  const datos = await respuesta.json()
  return responder(datos)
})
