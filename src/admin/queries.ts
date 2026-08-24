import { supabase, BUCKET_EVIDENCIAS } from '@/lib/supabase'
import type {
  AvisoChofer,
  CargaCombustible,
  Chofer,
  Empresa,
  EstadoIncidencia,
  EstadoUnidad,
  GastoChofer,
  IncidenciaChofer,
  TipoAviso,
  Unidad,
} from '@/lib/database.types'

/**
 * Consultas del panel de administración.
 *
 * Todo pasa por RLS con la sesión del admin: no hay clave privilegiada en el
 * navegador. Las políticas `*_select` ya permiten al admin ver todo lo de sus
 * empresas, así que no hizo falta tocar la base para esto.
 */

export interface TurnoAdmin {
  id: string
  empresa_id: string
  fecha: string
  estado: string
  entrada_el: string | null
  salida_el: string | null
  km_inicial: number | null
  km_final: number | null
  ruta_turno: string | null
  observaciones: string | null
  firma_ruta: string | null
  chofer_id: string
  unidad_id: string
  chofer: { nombre: string } | null
  unidad: { placa: string; marca: string | null; modelo: string | null } | null
}

const SELECT_TURNO =
  'id, empresa_id, fecha, estado, entrada_el, salida_el, km_inicial, km_final, ruta_turno, observaciones, firma_ruta, chofer_id, unidad_id, chofer:choferes(nombre), unidad:unidades(placa, marca, modelo)'

/**
 * Empresas que este admin puede usar.
 *
 * La política de `empresas` deja ver todas las activas, así que el filtro por
 * pertenencia se hace acá: si no, el admin elegiría una empresa ajena y sólo
 * se enteraría al enviar, cuando la Edge Function lo rechaza.
 * `empresas_permitidas` en NULL significa "todas" — así funcionan los admins
 * generales de `dash`.
 */
export async function listarEmpresas(permitidas: string[] | null): Promise<Empresa[]> {
  const { data } = await supabase.from('empresas').select('*').eq('activo', true).order('nombre')
  const todas = data ?? []
  if (permitidas === null) return todas
  return todas.filter((e) => permitidas.includes(e.slug))
}

export async function listarChoferes(): Promise<Chofer[]> {
  const { data } = await supabase.from('choferes').select('*').order('nombre')
  return data ?? []
}

export async function listarUnidades(): Promise<Unidad[]> {
  const { data } = await supabase.from('unidades').select('*').order('placa')
  return data ?? []
}

/**
 * Choferes activos que NO abrieron turno en la fecha dada.
 *
 * Se resuelve con dos consultas y un diff en memoria en vez de un LEFT JOIN:
 * PostgREST no expone anti-joins, y con la cantidad de choferes de una flota
 * (decenas, no miles) traer ambas listas es más simple y igual de rápido que
 * mantener una vista en la base.
 */
export async function sinRegistrar(fecha: string): Promise<Chofer[]> {
  const [{ data: choferes }, { data: turnos }] = await Promise.all([
    supabase.from('choferes').select('*').eq('activo', true).order('nombre'),
    supabase.from('checklists_unidad').select('chofer_id').eq('fecha', fecha),
  ])

  const registraron = new Set((turnos ?? []).map((t) => t.chofer_id))
  return (choferes ?? []).filter((c) => !registraron.has(c.id))
}

export async function turnosDe(fecha: string): Promise<TurnoAdmin[]> {
  const { data } = await supabase
    .from('checklists_unidad')
    .select(SELECT_TURNO)
    .eq('fecha', fecha)
    .order('entrada_el', { ascending: true })
  return (data ?? []) as unknown as TurnoAdmin[]
}

export async function listarTurnos(desde: string, hasta: string): Promise<TurnoAdmin[]> {
  const { data } = await supabase
    .from('checklists_unidad')
    .select(SELECT_TURNO)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .limit(300)
  return (data ?? []) as unknown as TurnoAdmin[]
}

/**
 * Firma en un solo request las rutas del bucket privado de evidencias.
 * Devuelve ruta → URL temporal (1 h). Una ruta que falla al firmar
 * simplemente no aparece en el mapa, y quien consulta muestra el hueco.
 */
async function firmarRutas(rutas: string[]): Promise<Map<string, string>> {
  const unicas = [...new Set(rutas)]
  if (unicas.length === 0) return new Map()

  const { data } = await supabase.storage.from(BUCKET_EVIDENCIAS).createSignedUrls(unicas, 3600)

  const mapa = new Map<string, string>()
  for (const f of data ?? []) {
    if (f.path && f.signedUrl) mapa.set(f.path, f.signedUrl)
  }
  return mapa
}

export interface FotoTurno {
  codigo: string
  etiqueta: string
  ruta: string
  url: string | null
  /** Cuándo la tomó el chofer: es lo que permite comprobar que es del momento */
  tomada_el: string | null
  momento: 'apertura' | 'cierre'
}

export interface DetalleTurno {
  turno: TurnoAdmin
  items: Array<{ codigo: string; etiqueta: string; estado: string; nota: string | null }>
  fotosApertura: FotoTurno[]
  fotosCierre: FotoTurno[]
  firmaUrl: string | null
}

export async function detalleTurno(id: string): Promise<DetalleTurno | null> {
  const { data: turno } = await supabase
    .from('checklists_unidad')
    .select(SELECT_TURNO)
    .eq('id', id)
    .maybeSingle()

  if (!turno) return null

  const [{ data: items }, { data: fotos }] = await Promise.all([
    supabase
      .from('checklist_unidad_items')
      .select('codigo, etiqueta, estado, nota')
      .eq('checklist_id', id)
      .order('orden'),
    supabase
      .from('checklist_unidad_fotos')
      .select('codigo, etiqueta, ruta, tomada_el')
      .eq('checklist_id', id),
  ])

  // El momento no se guarda en la foto sino en el catálogo, así que se resuelve
  // por código. Sin esto el panel mostraba las diez de la apertura y la del
  // cierre en un solo bloque, y no había forma de saber cuál era cuál.
  const { data: catalogo } = await supabase
    .from('checklist_catalogo_fotos')
    .select('codigo, momento')
    .eq('empresa_id', (turno as unknown as TurnoAdmin).empresa_id)

  const momentoPorCodigo = new Map((catalogo ?? []).map((c) => [c.codigo, c.momento]))

  const t = turno as unknown as TurnoAdmin

  // El bucket es privado: las imágenes sólo se ven con URL firmada temporal.
  const porRuta = await firmarRutas([
    ...(fotos ?? []).map((f) => f.ruta),
    ...(t.firma_ruta ? [t.firma_ruta] : []),
  ])

  const todas: FotoTurno[] = (fotos ?? []).map((f) => ({
    ...f,
    url: porRuta.get(f.ruta) ?? null,
    momento: momentoPorCodigo.get(f.codigo) ?? 'apertura',
  }))

  return {
    turno: t,
    items: items ?? [],
    fotosApertura: todas.filter((f) => f.momento === 'apertura'),
    fotosCierre: todas.filter((f) => f.momento === 'cierre'),
    firmaUrl: (t.firma_ruta && porRuta.get(t.firma_ruta)) || null,
  }
}

export interface CargaAdmin extends CargaCombustible {
  chofer: { nombre: string } | null
  unidad: { placa: string } | null
  /** URL firmada del ticket, cuando el chofer lo fotografió. */
  ticket_url: string | null
}

export async function listarCargas(desde: string, hasta: string): Promise<CargaAdmin[]> {
  const { data } = await supabase
    .from('cargas_combustible')
    .select('*, chofer:choferes(nombre), unidad:unidades(placa)')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .limit(300)

  const filas = (data ?? []) as unknown as CargaAdmin[]
  const urls = await firmarRutas(filas.map((f) => f.ticket_ruta).filter((r) => r != null))
  return filas.map((f) => ({
    ...f,
    ticket_url: (f.ticket_ruta && urls.get(f.ticket_ruta)) || null,
  }))
}

export interface GastoAdmin extends GastoChofer {
  chofer: { nombre: string } | null
  unidad: { placa: string } | null
  /** URL firmada del ticket, cuando el chofer lo fotografió. */
  ticket_url: string | null
}

export async function listarGastos(desde: string, hasta: string): Promise<GastoAdmin[]> {
  const { data } = await supabase
    .from('gastos_chofer')
    .select('*, chofer:choferes(nombre), unidad:unidades(placa)')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .limit(300)

  const filas = (data ?? []) as unknown as GastoAdmin[]
  const urls = await firmarRutas(filas.map((f) => f.ticket_ruta).filter((r) => r != null))
  return filas.map((f) => ({
    ...f,
    ticket_url: (f.ticket_ruta && urls.get(f.ticket_ruta)) || null,
  }))
}

export interface IncidenciaAdmin extends IncidenciaChofer {
  chofer: { nombre: string } | null
  unidad: { placa: string } | null
}

export async function listarIncidencias(soloAbiertas = false): Promise<IncidenciaAdmin[]> {
  let q = supabase
    .from('incidencias_chofer')
    .select('*, chofer:choferes(nombre), unidad:unidades(placa)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (soloAbiertas) q = q.in('estado', ['abierta', 'vista'])

  const { data } = await q
  return (data ?? []) as unknown as IncidenciaAdmin[]
}

export async function cambiarEstadoIncidencia(id: string, estado: EstadoIncidencia) {
  const { error } = await supabase
    .from('incidencias_chofer')
    .update({
      estado,
      atendida_el: estado === 'resuelta' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) throw error
}

/** Puntos marcados "No OK" en el rango: lo que el taller necesita ver. */
export async function fallasRecientes(desde: string) {
  // El cast es necesario porque los tipos de este proyecto están escritos a
  // mano con `Relationships: []`, así que PostgREST no puede inferir la forma
  // de la relación embebida y la colapsa a `never`.
  const { data } = await supabase
    .from('checklists_unidad')
    .select('id, fecha, unidad_id, unidad:unidades(placa)')
    .gte('fecha', desde)

  const turnos = (data ?? []) as unknown as Array<{
    id: string
    fecha: string
    unidad: { placa: string } | null
  }>

  if (!turnos.length) return []

  const { data: items } = await supabase
    .from('checklist_unidad_items')
    .select('checklist_id, codigo, etiqueta, nota')
    .eq('estado', 'no_ok')
    .in(
      'checklist_id',
      turnos.map((t) => t.id),
    )

  const porTurno = new Map(turnos.map((t) => [t.id, t]))
  return (items ?? []).map((i) => {
    const t = porTurno.get(i.checklist_id)
    return {
      fecha: t?.fecha ?? '',
      placa: t?.unidad?.placa ?? '—',
      etiqueta: i.etiqueta,
      nota: i.nota,
    }
  })
}

export async function crearUnidad(datos: {
  empresa_id: string
  placa: string
  alias: string | null
  marca: string | null
  modelo: string | null
  anio: number | null
}) {
  const { error } = await supabase.from('unidades').insert(datos)
  if (error) throw error
}

export async function actualizarUnidad(
  id: string,
  datos: {
    placa: string
    alias: string | null
    marca: string | null
    modelo: string | null
    anio: number | null
    estado: EstadoUnidad
  },
) {
  const { error } = await supabase.from('unidades').update(datos).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Borra una unidad. Sólo funciona si nada la referencia: los turnos, cargas
 * y gastos apuntan a `unidad_id` sin CASCADE a propósito — borrar la unidad
 * no debe borrar su historial. Para retirar una con registros, se desactiva.
 */
export async function eliminarUnidad(id: string) {
  const { error } = await supabase.from('unidades').delete().eq('id', id)
  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Esta unidad ya tiene registros (turnos, cargas o gastos) y no se puede eliminar sin perderlos. Desactivala: deja de aparecer en la app de los choferes pero su historial se conserva.',
      )
    }
    throw new Error(error.message)
  }
}

/** La app del chofer sólo lista unidades activas: desactivar la retira de uso. */
export async function cambiarActivoUnidad(id: string, activo: boolean) {
  const { error } = await supabase.from('unidades').update({ activo }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function cambiarActivoChofer(id: string, activo: boolean) {
  const { error } = await supabase.from('choferes').update({ activo }).eq('id', id)
  if (error) throw error
}

export async function actualizarChofer(
  id: string,
  datos: {
    nombre: string
    telefono: string | null
    licencia_numero: string | null
    licencia_vence_el: string | null
  },
) {
  const { error } = await supabase.from('choferes').update(datos).eq('id', id)
  if (error) throw error
}

// -------------------------------------------------------------- avisos

export interface AvisoAdmin extends AvisoChofer {
  chofer: { nombre: string } | null
}

export async function listarAvisos(): Promise<AvisoAdmin[]> {
  const { data } = await supabase
    .from('avisos_chofer')
    .select('*, chofer:choferes(nombre)')
    .order('created_at', { ascending: false })
    .limit(200)
  return (data ?? []) as unknown as AvisoAdmin[]
}

/**
 * Manda un aviso a un chofer o a todos los activos.
 *
 * Se inserta una fila por destinatario en vez de una sola con destinatario
 * "todos": así cada chofer tiene su propio estado de leído, que es lo que
 * permite saber quién realmente lo vio.
 */
export async function enviarAviso(datos: {
  empresaId: string
  choferIds: string[]
  titulo: string
  cuerpo: string
  tipo: TipoAviso
}) {
  if (datos.choferIds.length === 0) throw new Error('Elegí al menos un destinatario')

  const { data: sesion } = await supabase.auth.getUser()

  const { error } = await supabase.from('avisos_chofer').insert(
    datos.choferIds.map((choferId) => ({
      empresa_id: datos.empresaId,
      chofer_id: choferId,
      titulo: datos.titulo.trim(),
      cuerpo: datos.cuerpo.trim(),
      tipo: datos.tipo,
      origen: 'manual' as const,
      creado_por: sesion.user?.id ?? null,
    })),
  )
  if (error) throw error
}

/** Dispara a mano el recordatorio que normalmente corre solo cada mañana. */
export async function generarRecordatorios(): Promise<number> {
  const { data, error } = await supabase.rpc('generar_recordatorios_sin_registro' as never)
  if (error) throw error
  return (data as unknown as number) ?? 0
}

/** Llama a la Edge Function: crear usuarios exige la service_role key. */
export async function crearChofer(datos: {
  email: string
  password: string
  nombre: string
  empresa_id: string
  telefono?: string | null
  licencia_numero?: string | null
  licencia_vence_el?: string | null
}) {
  const { data, error } = await supabase.functions.invoke('admin-choferes', {
    body: { accion: 'crear', ...datos },
  })

  // Los errores del edge vienen en el cuerpo, no como excepción.
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detalle?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function restablecerPassword(choferId: string, password: string) {
  const { data, error } = await supabase.functions.invoke('admin-choferes', {
    body: { accion: 'restablecer_password', chofer_id: choferId, password },
  })
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detalle?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
}
