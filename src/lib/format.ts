const MONEY = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const LITERS = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const KM = new Intl.NumberFormat('es-MX')

export const money = (value: number | null | undefined) => (value == null ? '—' : MONEY.format(value))
export const liters = (value: number | null | undefined) =>
  value == null ? '—' : `${LITERS.format(value)} Lts`
export const km = (value: number | null | undefined) => (value == null ? '—' : `${KM.format(value)} km`)

export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function clockTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function unidadLabel(
  unidad: { marca: string | null; modelo: string | null; placa: string; alias: string | null } | null,
) {
  if (!unidad) return 'Sin unidad'
  const nombre = [unidad.marca, unidad.modelo].filter(Boolean).join(' ') || unidad.alias || 'Unidad'
  return `${nombre} · ${unidad.placa}`
}
