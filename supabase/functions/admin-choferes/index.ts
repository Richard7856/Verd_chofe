import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Alta y baja de choferes desde el panel de administración.
 *
 * Existe porque crear usuarios exige la service_role key, y esa clave NUNCA
 * puede vivir en el navegador: quien la tenga se salta RLS por completo. Acá
 * queda del lado del servidor y la función verifica, con sus propios medios,
 * que quien llama sea administrador.
 *
 * Tener esto permite además apagar el registro público (`disable_signup`),
 * que hoy deja que cualquiera se cree una cuenta y lea la contabilidad.
 */

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)

  const autorizacion = req.headers.get('Authorization')
  if (!autorizacion) return responder({ error: 'Falta la sesión' }, 401)

  // Cliente con el JWT de quien llama: sirve sólo para saber QUIÉN es.
  const comoUsuario = createClient(URL_SUPABASE, CLAVE_ANON, {
    global: { headers: { Authorization: autorizacion } },
  })
  const {
    data: { user },
  } = await comoUsuario.auth.getUser()
  if (!user) return responder({ error: 'Sesión inválida o vencida' }, 401)

  const admin = createClient(URL_SUPABASE, CLAVE_SERVICIO)

  // El rol se lee con service_role a propósito: si dependiera de RLS y las
  // políticas cambiaran, esta verificación podría quedar sin efecto.
  const { data: perfil } = await admin
    .from('profiles')
    .select('rol, empresas_permitidas')
    .eq('id', user.id)
    .maybeSingle()

  if (!perfil || perfil.rol !== 'admin') {
    return responder({ error: 'Sólo un administrador puede gestionar choferes' }, 403)
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await req.json()
  } catch {
    return responder({ error: 'Cuerpo inválido' }, 400)
  }

  const accion = String(cuerpo.accion ?? '')

  // ------------------------------------------------------------- alta
  if (accion === 'crear') {
    const email = String(cuerpo.email ?? '').trim().toLowerCase()
    const password = String(cuerpo.password ?? '')
    const nombre = String(cuerpo.nombre ?? '').trim()
    const empresaId = String(cuerpo.empresa_id ?? '')
    const telefono = cuerpo.telefono ? String(cuerpo.telefono).trim() : null
    const licencia = cuerpo.licencia_numero ? String(cuerpo.licencia_numero).trim() : null
    const licenciaVence = cuerpo.licencia_vence_el ? String(cuerpo.licencia_vence_el) : null

    if (!email.includes('@')) return responder({ error: 'Correo inválido' }, 400)
    if (password.length < 8) return responder({ error: 'La contraseña necesita 8 caracteres o más' }, 400)
    if (nombre.length < 3) return responder({ error: 'Escribí el nombre del chofer' }, 400)
    if (!empresaId) return responder({ error: 'Falta la empresa' }, 400)

    // Un admin sólo da de alta en sus propias empresas.
    const permitidas = perfil.empresas_permitidas as string[] | null
    if (permitidas !== null) {
      const { data: empresa } = await admin
        .from('empresas')
        .select('slug')
        .eq('id', empresaId)
        .maybeSingle()
      if (!empresa || !permitidas.includes(empresa.slug)) {
        return responder({ error: 'No podés dar de alta en esa empresa' }, 403)
      }
    }

    const { data: creado, error: errorAlta } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // el chofer no tiene por qué revisar un correo
      user_metadata: { nombre },
    })

    if (errorAlta || !creado.user) {
      const yaExiste = errorAlta?.message?.toLowerCase().includes('already')
      return responder(
        { error: yaExiste ? 'Ya existe un usuario con ese correo' : (errorAlta?.message ?? 'No se pudo crear el usuario') },
        yaExiste ? 409 : 400,
      )
    }

    // El trigger on_auth_user_created ya creó el profiles; se completa nombre
    // y se limita a la empresa del chofer.
    const { data: empresaSlug } = await admin
      .from('empresas')
      .select('slug')
      .eq('id', empresaId)
      .maybeSingle()

    await admin
      .from('profiles')
      .update({ nombre, empresas_permitidas: empresaSlug ? [empresaSlug.slug] : [] })
      .eq('id', creado.user.id)

    const { data: chofer, error: errorChofer } = await admin
      .from('choferes')
      .insert({
        user_id: creado.user.id,
        empresa_id: empresaId,
        nombre,
        telefono,
        licencia_numero: licencia,
        licencia_vence_el: licenciaVence,
      })
      .select()
      .single()

    if (errorChofer) {
      // Sin fila en `choferes` el usuario no puede hacer nada y quedaría
      // suelto: se revierte el alta para no dejar basura en auth.
      await admin.auth.admin.deleteUser(creado.user.id)
      return responder({ error: `No se pudo crear el chofer: ${errorChofer.message}` }, 400)
    }

    return responder({ chofer })
  }

  // ------------------------------------------- cambio de contraseña
  if (accion === 'restablecer_password') {
    const choferId = String(cuerpo.chofer_id ?? '')
    const password = String(cuerpo.password ?? '')
    if (password.length < 8) return responder({ error: 'La contraseña necesita 8 caracteres o más' }, 400)

    const { data: chofer } = await admin
      .from('choferes')
      .select('user_id, empresa_id')
      .eq('id', choferId)
      .maybeSingle()
    if (!chofer) return responder({ error: 'Chofer no encontrado' }, 404)

    const { error } = await admin.auth.admin.updateUserById(chofer.user_id, { password })
    if (error) return responder({ error: error.message }, 400)

    return responder({ ok: true })
  }

  return responder({ error: `Acción desconocida: ${accion}` }, 400)
})
