import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from '@/components/Icons'
import { cx } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'

const SECCIONES: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/admin', label: 'Resumen', icon: 'home' },
  { to: '/admin/turnos', label: 'Turnos', icon: 'clipboard' },
  { to: '/admin/choferes', label: 'Choferes', icon: 'user' },
  { to: '/admin/unidades', label: 'Unidades', icon: 'car' },
  { to: '/admin/combustible', label: 'Combustible', icon: 'fuel' },
  { to: '/admin/gastos', label: 'Gastos extra', icon: 'tool' },
  { to: '/admin/incidencias', label: 'Incidencias', icon: 'alert' },
  { to: '/admin/avisos', label: 'Avisos', icon: 'bell' },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const location = useLocation()

  const menu = (
    <nav className="flex flex-col gap-0.5">
      {SECCIONES.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.to === '/admin'}
          onClick={() => setMenuAbierto(false)}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              isActive
                ? 'bg-brand-500 font-semibold text-white'
                : 'text-body hover:bg-brand-50 hover:text-brand-700',
            )
          }
        >
          <Icon name={s.icon} size={18} />
          {s.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-surface-alt">
      {/* barra superior — en escritorio sólo muestra identidad */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3 lg:px-6">
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            aria-label="Menú"
            className="tap-target -ml-2 flex items-center justify-center rounded-lg px-2 text-ink lg:hidden"
          >
            <Icon name="menu" size={22} />
          </button>

          <div className="flex flex-1 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Icon name="truck" size={20} />
            </span>
            <div className="leading-tight">
              <p className="text-[15px] font-bold text-ink">Panel de administración</p>
              <p className="text-xs text-body-soft">Choferes y unidades</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-semibold text-ink">{profile?.nombre || profile?.email}</p>
              <p className="text-xs text-body-soft">Administrador</p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              title="Cerrar sesión"
              className="tap-target flex items-center justify-center rounded-lg px-2 text-body-soft hover:text-ink"
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4 py-5 lg:px-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-[76px]">{menu}</div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* menú lateral en pantallas chicas */}
      {menuAbierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuAbierto(false)}
            aria-hidden="true"
          />
          <aside className="relative h-full w-64 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-bold text-ink">Secciones</p>
              <button type="button" onClick={() => setMenuAbierto(false)} aria-label="Cerrar">
                <Icon name="x" size={20} />
              </button>
            </div>
            {menu}
          </aside>
        </div>
      )}

      <p className="pb-6 text-center text-xs text-body-soft lg:hidden">{location.pathname}</p>
    </div>
  )
}

// ---------------------------------------------------------------- piezas

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-extrabold text-ink">{children}</h1>
      {action}
    </div>
  )
}

export function Panel({
  title,
  children,
  action,
  className,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={cx('rounded-xl border border-gray-200 bg-white', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="font-bold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Metric({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'ok' | 'warn' | 'danger'
  hint?: string
}) {
  const tonos = {
    neutral: 'text-ink',
    ok: 'text-brand-600',
    warn: 'text-accent-600',
    danger: 'text-[--color-danger]',
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-body-soft">{label}</p>
      <p className={cx('mt-1 text-3xl font-extrabold tabular-nums', tonos[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-body-soft">{hint}</p>}
    </div>
  )
}

/** Tabla con scroll horizontal propio: nunca empuja el ancho de la página. */
export function Tabla({
  columnas,
  children,
  vacio,
}: {
  columnas: string[]
  children: ReactNode
  vacio?: string
}) {
  const sinFilas = Array.isArray(children) ? children.flat().length === 0 : !children

  if (sinFilas) {
    return <p className="px-4 py-10 text-center text-sm text-body-soft">{vacio ?? 'Sin datos'}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-body-soft">
            {columnas.map((c) => (
              <th key={c} className="whitespace-nowrap px-4 py-2.5 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('px-4 py-2.5 align-middle', className)}>{children}</td>
}
