import { supabase, BUCKET_EVIDENCIAS } from '@/lib/supabase'
import type {
  AvisoChofer,
  CargaCombustible,
  Chofer,
  Empresa,
  EstadoIncidencia,
  EstadoRevision,
  EstadoUnidad,
  GastoChofer,
  IncidenciaChofer,
  OrigenFoto,
  RevisionFoto,
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
  /** Lo cerró el sistema a las 23:59, no el chofer: cuenta como falta */
  cierre_automatico: boolean
  cerrado_automatico_el: string | null
  chofer_id: string
  unidad_id: string
  chofer: { nombre: string } | null
  unidad: { placa: string; marca: string | null; modelo: string | null } | null
}

const SELECT_TURNO =
  'id, empresa_id, fecha, estado, entrada_el, salida_el, km_inicial, km_final, ruta_turno, observaciones, firma_ruta, cierre_automatico, cerrado_automatico_el, chofer_id, unidad_id, chofer:choferes(nombre), unidad:unidades(placa, marca, modelo)'

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

export interface ChoferAdmin extends Chofer {
  email: string | null
}

export async function listarChoferes(): Promise<ChoferAdmin[]> {
  const { data } = await supabase.from('choferes').select('*').order('nombre')
  const choferes = (data ?? []) as Chofer[]
  if (choferes.length === 0) return []

  // El correo vive en `profiles`: la política sólo le muestra al admin los
  // perfiles de choferes de sus empresas, así que esto no abre nada de más.
  const { data: perfiles } = await supabase
    .from('profiles')
    .select('id, email')
    .in(
      'id',
      choferes.map((c) => c.user_id),
    )

  const emailPorUsuario = new Map((perfiles ?? []).map((p) => [p.id, p.email]))
  return choferes.map((c) => ({ ...c, email: emailPorUsuario.get(c.user_id) ?? null }))
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
  revision: RevisionFoto | null
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
  const [porRuta, revisiones] = await Promise.all([
    firmarRutas([
      ...(fotos ?? []).map((f) => f.ruta),
      ...(t.firma_ruta ? [t.firma_ruta] : []),
    ]),
    revisionesPorRuta((fotos ?? []).map((f) => f.ruta)),
  ])

  const todas: FotoTurno[] = (fotos ?? []).map((f) => ({
    ...f,
    url: porRuta.get(f.ruta) ?? null,
    momento: momentoPorCodigo.get(f.codigo) ?? 'apertura',
    revision: revisiones.get(f.ruta) ?? null,
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
  ticket_revision: RevisionFoto | null
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
  const rutas = filas.map((f) => f.ticket_ruta)
  const [urls, revisiones] = await Promise.all([
    firmarRutas(rutas.filter((r) => r != null)),
    revisionesPorRuta(rutas),
  ])
  return filas.map((f) => ({
    ...f,
    ticket_url: (f.ticket_ruta && urls.get(f.ticket_ruta)) || null,
    ticket_revision: (f.ticket_ruta && revisiones.get(f.ticket_ruta)) || null,
  }))
}

export interface GastoAdmin extends GastoChofer {
  chofer: { nombre: string } | null
  unidad: { placa: string } | null
  /** URL firmada del ticket, cuando el chofer lo fotografió. */
  ticket_url: string | null
  ticket_revision: RevisionFoto | null
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
  const rutas = filas.map((f) => f.ticket_ruta)
  const [urls, revisiones] = await Promise.all([
    firmarRutas(rutas.filter((r) => r != null)),
    revisionesPorRuta(rutas),
  ])
  return filas.map((f) => ({
    ...f,
    ticket_url: (f.ticket_ruta && urls.get(f.ticket_ruta)) || null,
    ticket_revision: (f.ticket_ruta && revisiones.get(f.ticket_ruta)) || null,
  }))
}

/**
 * Borra una carga o un gasto y todo lo que cuelga de él: el ticket en el
 * bucket y su revisión. Se usa para los duplicados, que el chofer sube sin
 * querer cuando la app tarda en confirmar y le vuelve a dar enviar.
 *
 * El registro va primero: si algo falla después, queda una foto suelta en el
 * bucket —basura inofensiva— y no un movimiento sin su comprobante. Las
 * políticas ya permitían el borrado al admin (`cargas_update` y
 * `gastos_chofer_admin` son FOR ALL), así que no hizo falta tocar la base.
 */
async function eliminarMovimiento(
  tabla: 'cargas_combustible' | 'gastos_chofer',
  id: string,
  ticketRuta: string | null,
) {
  const { error } = await supabase.from(tabla).delete().eq('id', id)
  if (error) throw new Error(error.message)

  if (ticketRuta) {
    await supabase.storage.from(BUCKET_EVIDENCIAS).remove([ticketRuta])
    await supabase.from('revisiones_foto').delete().eq('ruta', ticketRuta)
  }
}

export function eliminarCarga(id: string, ticketRuta: string | null) {
  return eliminarMovimiento('cargas_combustible', id, ticketRuta)
}

export function eliminarGasto(id: string, ticketRuta: string | null) {
  return eliminarMovimiento('gastos_chofer', id, ticketRuta)
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

// -------------------------------------------------- revisión del gasto

/**
 * Aprueba o rechaza una carga o un gasto.
 *
 * Lo decide una persona y no una regla: entre lo que rinde una camioneta en
 * el papel y lo que rinde en tráfico siempre hay diferencia, y ningún umbral
 * acierta solo. El panel marca lo que se sale de rango; el admin resuelve.
 */
export async function revisarMovimiento(
  tabla: 'cargas_combustible' | 'gastos_chofer',
  id: string,
  estado: 'aprobado' | 'rechazado' | 'pendiente',
  nota?: string,
) {
  const { data: sesion } = await supabase.auth.getUser()

  const { error } = await supabase
    .from(tabla)
    .update({
      estado_revision: estado,
      revisado_por: estado === 'pendiente' ? null : (sesion.user?.id ?? null),
      revisado_el: estado === 'pendiente' ? null : new Date().toISOString(),
      nota_revision: nota?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function actualizarRendimiento(unidadId: string, kmPorLitro: number | null) {
  const { error } = await supabase
    .from('unidades')
    .update({ rendimiento_km_litro: kmPorLitro })
    .eq('id', unidadId)
  if (error) throw new Error(error.message)
}

// -------------------------------------------------- el día completo

export interface MovimientoDia {
  id: string
  tipo: 'combustible' | 'gasto'
  etiqueta: string
  monto: number
  litros: number | null
  estado_revision: EstadoRevision
  ticket_url: string | null
  ticket_ruta: string | null
  chofer_id: string
  checklist_id: string | null
}

/** Cargas y gastos de un día, en una sola lista y con su ticket firmado. */
export async function movimientosDelDia(fecha: string): Promise<MovimientoDia[]> {
  const [cargas, gastos] = await Promise.all([
    supabase
      .from('cargas_combustible')
      .select('id, chofer_id, checklist_id, estacion, litros, total, ticket_ruta, estado_revision')
      .eq('fecha', fecha),
    supabase
      .from('gastos_chofer')
      .select('id, chofer_id, checklist_id, tipo, descripcion, monto, ticket_ruta, estado_revision')
      .eq('fecha', fecha),
  ])

  const filas: MovimientoDia[] = [
    ...((cargas.data ?? []) as never[]).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      tipo: 'combustible' as const,
      etiqueta: (c.estacion as string) || 'Combustible',
      monto: Number(c.total),
      litros: Number(c.litros),
      estado_revision: c.estado_revision as EstadoRevision,
      ticket_ruta: (c.ticket_ruta as string) ?? null,
      ticket_url: null,
      chofer_id: c.chofer_id as string,
      checklist_id: (c.checklist_id as string) ?? null,
    })),
    ...((gastos.data ?? []) as never[]).map((g: Record<string, unknown>) => ({
      id: g.id as string,
      tipo: 'gasto' as const,
      etiqueta: (g.descripcion as string) || (g.tipo as string),
      monto: Number(g.monto),
      litros: null,
      estado_revision: g.estado_revision as EstadoRevision,
      ticket_ruta: (g.ticket_ruta as string) ?? null,
      ticket_url: null,
      chofer_id: g.chofer_id as string,
      checklist_id: (g.checklist_id as string) ?? null,
    })),
  ]

  const urls = await firmarRutas(filas.map((f) => f.ticket_ruta).filter((r) => r != null))
  return filas.map((f) => ({
    ...f,
    ticket_url: (f.ticket_ruta && urls.get(f.ticket_ruta)) || null,
  }))
}

// -------------------------------------------------- rutas de TripDrive

/** Una ruta como la devuelve la API de socios. */
export interface RutaTripDrive {
  id: string
  date: string
  name: string
  status: string
  zone: { code: string; name: string } | null
  vehicle: { plate: string; color: string | null } | null
  driver: { name: string } | null
  stops: number
  /**
   * La distancia del plan. Es el número a comparar: existe desde que la ruta
   * se optimiza y es el que TripDrive le muestra al cliente.
   */
  km_planned: number | null
  /**
   * Suma de los puntos GPS del teléfono. NO es "el kilometraje real": si la
   * app deja de grabar faltan tramos, y si el GPS salta sobran. Sólo sirve
   * cuando `gps_quality` es 'ok'.
   */
  km_gps: number | null
  gps_quality: 'ok' | 'unreliable' | 'no_data' | null
  started_at: string | null
  ended_at: string | null
}

/** Consulta las rutas por la Edge Function: la llave no puede vivir acá. */
export async function rutasTripDrive(desde: string, hasta: string): Promise<RutaTripDrive[]> {
  const { data, error } = await supabase.functions.invoke('tripdrive-rutas', {
    body: { desde, hasta },
  })

  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detalle?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)

  return (data?.routes ?? []) as RutaTripDrive[]
}

/** Un turno vinculado a una ruta de TripDrive. */
export interface VinculoRuta {
  id: string
  checklist_id: string
  ruta_id: string
  ruta_fecha: string
  ruta_nombre: string | null
  ruta_placa: string | null
  ruta_chofer: string | null
  km_planned: number | null
}

export async function vinculosDeRutas(desde: string, hasta: string): Promise<VinculoRuta[]> {
  const { data } = await supabase
    .from('turno_rutas_tripdrive')
    .select('id, checklist_id, ruta_id, ruta_fecha, ruta_nombre, ruta_placa, ruta_chofer, km_planned')
    .gte('ruta_fecha', desde)
    .lte('ruta_fecha', hasta)

  return (data ?? []) as unknown as VinculoRuta[]
}

/**
 * Ata una ruta de TripDrive a un turno. Guarda una copia de lo que decía la
 * ruta: la API puede re-optimizarla o no responder, y el histórico no debería
 * depender de eso.
 */
export async function vincularRuta(
  turno: { id: string; empresa_id: string },
  ruta: RutaTripDrive,
) {
  const { data: sesion } = await supabase.auth.getUser()

  const { error } = await supabase.from('turno_rutas_tripdrive').insert({
    empresa_id: turno.empresa_id,
    checklist_id: turno.id,
    ruta_id: ruta.id,
    ruta_fecha: ruta.date,
    ruta_nombre: ruta.vehicle?.color ?? ruta.name,
    ruta_placa: ruta.vehicle?.plate ?? null,
    ruta_chofer: ruta.driver?.name ?? null,
    km_planned: ruta.km_planned,
    vinculado_por: sesion.user?.id ?? null,
  })

  if (error) {
    // La ruta ya está atada a otro turno: el UNIQUE lo impide a propósito,
    // porque si no se contaría dos veces.
    if (error.code === '23505') {
      throw new Error('Esa ruta ya está vinculada a otro turno.')
    }
    throw new Error(error.message)
  }
}

export async function desvincularRuta(id: string) {
  const { error } = await supabase.from('turno_rutas_tripdrive').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Turnos del rango con lo necesario para cruzarlos contra las rutas. */
export async function turnosParaComparar(desde: string, hasta: string) {
  const { data } = await supabase
    .from('checklists_unidad')
    .select(
      'id, empresa_id, chofer_id, fecha, estado, km_inicial, km_final, cierre_automatico, chofer:choferes(nombre), unidad:unidades(placa, alias, rendimiento_km_litro)',
    )
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .limit(500)

  return (data ?? []) as unknown as Array<{
    id: string
    empresa_id: string
    chofer_id: string
    fecha: string
    estado: string
    km_inicial: number | null
    km_final: number | null
    cierre_automatico: boolean
    chofer: { nombre: string } | null
    unidad: { placa: string; alias: string | null; rendimiento_km_litro: number | null } | null
  }>
}

// -------------------------------------------------- reporte por chofer

export interface TurnoReporte {
  id: string
  fecha: string
  estado: string
  km_inicial: number | null
  km_final: number | null
  cierre_automatico: boolean
  unidad: { placa: string } | null
}

export interface CargaReporte {
  id: string
  fecha: string
  litros: number
  precio_litro: number
  total: number
  estacion: string | null
  unidad: { placa: string } | null
}

export interface GastoReporte {
  id: string
  fecha: string
  tipo: string
  monto: number
  lugar: string | null
  descripcion: string | null
  unidad: { placa: string } | null
}

export interface IncidenciaReporte {
  id: string
  created_at: string
  tipo: string
  descripcion: string
  estado: string
}

/** Todo lo que hizo un chofer en el rango: la vista para revisar a una persona. */
export async function reporteChofer(choferId: string, desde: string, hasta: string) {
  const [turnos, cargas, gastos, incidencias] = await Promise.all([
    supabase
      .from('checklists_unidad')
      .select('id, fecha, estado, km_inicial, km_final, cierre_automatico, unidad:unidades(placa)')
      .eq('chofer_id', choferId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false }),
    supabase
      .from('cargas_combustible')
      .select('id, fecha, litros, precio_litro, total, estacion, unidad:unidades(placa)')
      .eq('chofer_id', choferId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false }),
    supabase
      .from('gastos_chofer')
      .select('id, fecha, tipo, monto, lugar, descripcion, unidad:unidades(placa)')
      .eq('chofer_id', choferId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false }),
    supabase
      .from('incidencias_chofer')
      .select('id, created_at, tipo, descripcion, estado')
      .eq('chofer_id', choferId)
      .gte('created_at', desde)
      .lte('created_at', `${hasta}T23:59:59`)
      .order('created_at', { ascending: false }),
  ])

  return {
    turnos: (turnos.data ?? []) as unknown as TurnoReporte[],
    cargas: (cargas.data ?? []) as unknown as CargaReporte[],
    gastos: (gastos.data ?? []) as unknown as GastoReporte[],
    incidencias: (incidencias.data ?? []) as unknown as IncidenciaReporte[],
  }
}

// -------------------------------------------------- revisión de fotos

/** Lo que identifica a una foto revisable, venga de donde venga. */
export interface DatosFoto {
  empresa_id: string
  chofer_id: string
  origen: OrigenFoto
  referencia_id: string
  etiqueta: string
  ruta: string
}

/** Revisiones existentes para un conjunto de rutas, indexadas por ruta. */
export async function revisionesPorRuta(
  rutas: Array<string | null>,
): Promise<Map<string, RevisionFoto>> {
  const unicas = [...new Set(rutas.filter((r) => r != null))]
  if (unicas.length === 0) return new Map()

  const { data } = await supabase.from('revisiones_foto').select('*').in('ruta', unicas)
  return new Map(((data ?? []) as RevisionFoto[]).map((r) => [r.ruta, r]))
}

export async function aprobarFoto(foto: DatosFoto) {
  const { data: sesion } = await supabase.auth.getUser()

  const { error } = await supabase.from('revisiones_foto').upsert(
    {
      ...foto,
      estado: 'aprobada' as const,
      motivo: null,
      revisada_por: sesion.user?.id ?? null,
      revisada_el: new Date().toISOString(),
      resubida_el: null,
    },
    { onConflict: 'ruta' },
  )
  if (error) throw new Error(error.message)
}

/**
 * Rechaza una foto: la borra del bucket, deja la revisión en 'rechazada' y
 * le manda un aviso al chofer. La app del chofer lista sus rechazadas y las
 * re-sube a la MISMA ruta, así que los registros no cambian.
 */
export async function rechazarFoto(foto: DatosFoto, motivo: string) {
  const { data: sesion } = await supabase.auth.getUser()

  // Primero la revisión: si esto falla, la foto no se toca.
  const { error } = await supabase.from('revisiones_foto').upsert(
    {
      ...foto,
      estado: 'rechazada' as const,
      motivo: motivo.trim(),
      revisada_por: sesion.user?.id ?? null,
      revisada_el: new Date().toISOString(),
      resubida_el: null,
    },
    { onConflict: 'ruta' },
  )
  if (error) throw new Error(error.message)

  await supabase.storage.from(BUCKET_EVIDENCIAS).remove([foto.ruta])

  // El aviso es lo primero que el chofer ve al abrir la app.
  await supabase.from('avisos_chofer').insert({
    empresa_id: foto.empresa_id,
    chofer_id: foto.chofer_id,
    titulo: 'Foto rechazada: hay que subirla de nuevo',
    cuerpo: `Tu foto "${foto.etiqueta}" fue rechazada: ${motivo.trim()}. Entrá a "Fotos por resubir" en la app y tomala otra vez.`,
    tipo: 'urgente' as const,
    origen: 'manual' as const,
    creado_por: sesion.user?.id ?? null,
  })
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
    rendimiento_km_litro: number | null
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

/**
 * Bloquea o desbloquea el acceso de un chofer. Va por la Edge Function porque
 * además de `choferes.activo` aplica un ban en auth: se le cae la sesión que
 * tenga abierta y no puede volver a iniciar sesión hasta desbloquearlo.
 */
export async function bloquearChofer(choferId: string, bloquear: boolean) {
  const { data, error } = await supabase.functions.invoke('admin-choferes', {
    body: { accion: bloquear ? 'bloquear' : 'desbloquear', chofer_id: choferId },
  })
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detalle?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
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

/**
 * Cierra los turnos que quedaron abiertos, igual que la tarea de las 23:59.
 * Está a mano para no tener que esperar al corte cuando ya se sabe que un
 * chofer no va a cerrar.
 */
export async function cerrarTurnosVencidos(): Promise<number> {
  const { data, error } = await supabase.rpc('cerrar_turnos_vencidos' as never)
  if (error) throw error
  return (data as unknown as number) ?? 0
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
