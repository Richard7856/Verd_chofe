/**
 * Tipos de las tablas que consume la app de choferes, del proyecto `dash`.
 *
 * Es un subconjunto a mano en vez del archivo generado completo: `dash` tiene
 * 43 tablas y la app sólo toca 12. Para regenerar todo:
 *   npx supabase gen types typescript --project-id uqgcjyopoaisuglljnuc
 */

export type EstadoChecklist = 'en_progreso' | 'completado' | 'cancelado'
export type EstadoItem = 'ok' | 'no_ok' | 'na'
export type EstadoUnidad = 'disponible' | 'en_ruta' | 'mantenimiento' | 'inactiva'
export type TipoIncidencia = 'camino' | 'entrega' | 'unidad' | 'otro'
export type EstadoIncidencia = 'abierta' | 'vista' | 'resuelta' | 'cancelada'

export type Profile = {
  id: string
  email: string | null
  nombre: string | null
  /** texto libre en la base: 'admin' | 'usuario' | 'proveedor' | … */
  rol: string
  activo: boolean | null
  empresas_permitidas: string[] | null
  password_change_required: boolean
}

export type Empresa = {
  id: string
  slug: string
  nombre: string
  subtitulo: string | null
  activo: boolean
}

export type Bodega = {
  id: string
  nombre: string
  codigo: string | null
  direccion: string | null
  empresa_id: string | null
  activo: boolean
}

export type Chofer = {
  id: string
  user_id: string
  empresa_id: string
  nombre: string
  telefono: string | null
  licencia_numero: string | null
  licencia_vence_el: string | null
  activo: boolean
}

export type Unidad = {
  id: string
  empresa_id: string
  placa: string
  alias: string | null
  marca: string | null
  modelo: string | null
  anio: number | null
  bodega_id: string | null
  estado: EstadoUnidad
  activo: boolean
  notas: string | null
}

export type ChoferUnidadAsignacion = {
  id: string
  empresa_id: string
  chofer_id: string
  unidad_id: string
  asignada_el: string
  liberada_el: string | null
}

export type CatalogoItem = {
  id: string
  empresa_id: string
  codigo: string
  etiqueta: string
  grupo: string | null
  orden: number
  activo: boolean
}

export type CatalogoFoto = {
  id: string
  empresa_id: string
  codigo: string
  etiqueta: string
  orden: number
  obligatoria: boolean
  activo: boolean
}

export type ChecklistUnidad = {
  id: string
  empresa_id: string
  chofer_id: string
  unidad_id: string
  bodega_id: string | null
  estado: EstadoChecklist
  fecha: string
  entrada_el: string | null
  km_inicial: number | null
  entrada_lat: number | null
  entrada_lng: number | null
  salida_el: string | null
  km_final: number | null
  salida_lat: number | null
  salida_lng: number | null
  ruta_turno: string | null
  observaciones: string | null
  firma_ruta: string | null
  firmado_el: string | null
  completado_el: string | null
  cliente_uuid: string
  created_at: string
  updated_at: string
}

export type ChecklistUnidadItem = {
  id: string
  checklist_id: string
  codigo: string
  etiqueta: string
  estado: EstadoItem
  nota: string | null
  orden: number
}

export type ChecklistUnidadFoto = {
  id: string
  checklist_id: string
  codigo: string
  etiqueta: string
  ruta: string
  tomada_el: string | null
  lat: number | null
  lng: number | null
}

export type CargaCombustible = {
  id: string
  empresa_id: string
  chofer_id: string
  unidad_id: string
  checklist_id: string | null
  fecha: string
  estacion: string | null
  litros: number
  precio_litro: number
  total: number
  km: number | null
  folio: string | null
  ticket_ruta: string | null
  lat: number | null
  lng: number | null
  cliente_uuid: string
  created_at: string
}

export type IncidenciaChofer = {
  id: string
  empresa_id: string
  chofer_id: string
  unidad_id: string | null
  checklist_id: string | null
  tipo: TipoIncidencia
  descripcion: string
  foto_ruta: string | null
  lat: number | null
  lng: number | null
  estado: EstadoIncidencia
  atendida_el: string | null
  atendida_por: string | null
  notas_cierre: string | null
  created_at: string
  updated_at: string
}

/**
 * supabase-js exige `Relationships` en cada tabla. Y los tipos de fila tienen
 * que ser `type`, no `interface`: una interface no es asignable a
 * `Record<string, unknown>` (no tiene índice implícito) y el esquema entero
 * colapsaría a `never`.
 */
export type TipoGasto = 'aceite' | 'anticongelante' | 'ponchadura' | 'otro'

export type GastoChofer = {
  id: string
  empresa_id: string
  chofer_id: string
  unidad_id: string
  checklist_id: string | null
  fecha: string
  tipo: TipoGasto
  /** Obligatoria cuando `tipo` es 'otro' — lo exige un CHECK en la base */
  descripcion: string | null
  monto: number
  lugar: string | null
  folio: string | null
  km: number | null
  ticket_ruta: string | null
  lat: number | null
  lng: number | null
  cliente_uuid: string
  created_at: string
}

export type TipoAviso = 'aviso' | 'recordatorio' | 'urgente'

export type AvisoChofer = {
  id: string
  empresa_id: string
  chofer_id: string
  titulo: string
  cuerpo: string
  tipo: TipoAviso
  /** 'manual' lo mandó un admin; 'automatico' lo generó la tarea programada */
  origen: 'manual' | 'automatico'
  creado_por: string | null
  clave: string | null
  leido_el: string | null
  created_at: string
}

type Tabla<T> = {
  Row: T
  Insert: Partial<T>
  Update: Partial<T>
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: Tabla<Profile>
      empresas: Tabla<Empresa>
      bodegas: Tabla<Bodega>
      choferes: Tabla<Chofer>
      unidades: Tabla<Unidad>
      chofer_unidad_asignaciones: Tabla<ChoferUnidadAsignacion>
      checklist_catalogo_items: Tabla<CatalogoItem>
      checklist_catalogo_fotos: Tabla<CatalogoFoto>
      checklists_unidad: Tabla<ChecklistUnidad>
      checklist_unidad_items: Tabla<ChecklistUnidadItem>
      checklist_unidad_fotos: Tabla<ChecklistUnidadFoto>
      cargas_combustible: Tabla<CargaCombustible>
      incidencias_chofer: Tabla<IncidenciaChofer>
      avisos_chofer: Tabla<AvisoChofer>
      gastos_chofer: Tabla<GastoChofer>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
