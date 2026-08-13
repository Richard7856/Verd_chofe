import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icons'
import { Badge, cx } from './ui'
import { useAuth } from '@/context/AuthContext'
import { useSync } from '@/context/SyncContext'
import { useAvisos } from '@/context/AvisosContext'

const APP_VERSION = '1.0.0'

const DRAWER_LINKS: Array<{ to: string; label: string; icon: IconName; badge?: string }> = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/registros', label: 'Mis Registros', icon: 'clipboard' },
  { to: '/avisos', label: 'Avisos', icon: 'bell' },
  { to: '/checklist/apertura', label: 'Registro de Entrada', icon: 'play' },
  { to: '/checklist/cierre', label: 'Cierre de Turno', icon: 'flag' },
  { to: '/combustible', label: 'Carga de Combustible', icon: 'fuel' },
  { to: '/gastos', label: 'Gastos Extra', icon: 'tool' },
  { to: '/documentos', label: 'Documentos', icon: 'file' },
  { to: '/servicios', label: 'Historial de Servicios', icon: 'wrench' },
  { to: '/incidencias', label: 'Incidencias', icon: 'alert' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
  { to: '/configuracion', label: 'Configuración', icon: 'settings' },
]

const TABS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/registros', label: 'Registros', icon: 'clipboard' },
  { to: '/unidad', label: 'Unidad', icon: 'car' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
]

/**
 * Aviso de estado. Sin botón: la sincronización es automática.
 *
 * Distingue "esperando señal" de "falló": son cosas distintas y sólo la
 * segunda necesita que alguien haga algo. Antes ambas se veían igual —un
 * contador que no bajaba— y un registro que no podía enviarse nunca parecía
 * estar simplemente esperando.
 */
export function OfflineBanner() {
  const { online, pending, syncing, fallidos, ultimoError } = useSync()

  if (online && pending === 0) return null

  const hayError = fallidos > 0 && online

  return (
    <div
      className={cx(
        'px-4 py-2 text-sm',
        hayError
          ? 'bg-red-50 text-[--color-danger]'
          : online
            ? 'bg-brand-50 text-brand-700'
            : 'bg-orange-50 text-accent-600',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          name={hayError ? 'alert' : online ? 'refresh' : 'cloudOff'}
          size={16}
          className={cx('shrink-0', syncing && !hayError && 'animate-spin')}
        />
        <span className="flex-1">
          {hayError
            ? `No se pudo enviar ${fallidos} registro${fallidos === 1 ? '' : 's'}`
            : !online
              ? `Sin conexión${pending > 0 ? ` · ${pending} guardado${pending === 1 ? '' : 's'} en el teléfono` : ''}`
              : syncing
                ? 'Enviando…'
                : `${pending} registro${pending === 1 ? '' : 's'} por enviar`}
        </span>
      </div>

      {hayError && ultimoError && (
        <p className="mt-0.5 pl-6 text-xs opacity-90">{ultimoError}</p>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { profile, chofer, empresa, signOut } = useAuth()
  const { sinLeer } = useAvisos()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => setDrawerOpen(false), [location.pathname])

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <header className="safe-top sticky top-0 z-30 bg-brand-600 text-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú"
            className="tap-target -ml-2 flex items-center justify-center rounded-lg px-2"
          >
            <Icon name="menu" size={22} />
          </button>

          <div className="flex flex-1 items-center gap-2">
            <Icon name="truck" size={22} />
            <span className="text-[15px] font-bold leading-tight">
              {empresa?.nombre ?? 'Choferes'}
              <span className="block text-[11px] font-medium opacity-80">Choferes</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigate('/avisos')}
            aria-label={sinLeer > 0 ? `Avisos: ${sinLeer} sin leer` : 'Avisos'}
            className="tap-target relative -mr-2 flex items-center justify-center rounded-lg px-2"
          >
            <Icon name="bell" size={20} />
            {sinLeer > 0 && (
              <span className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white">
                {sinLeer > 9 ? '9+' : sinLeer}
              </span>
            )}
          </button>
        </div>
      </header>

      <OfflineBanner />

      <main className="flex-1 pb-24">{children}</main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white">
        <ul className="flex">
          {TABS.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                    isActive ? 'text-brand-500' : 'text-body-soft',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon name={tab.icon} size={21} strokeWidth={isActive ? 2.2 : 1.75} />
                    {tab.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* ---------------------------------------------------- drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />

          <aside className="relative flex h-full w-[82%] max-w-xs flex-col bg-white shadow-xl">
            <div className="safe-top bg-brand-600 px-5 pb-5 pt-4 text-white">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon name="truck" size={26} />
                  <div className="text-[17px] font-extrabold leading-tight">
                    {empresa?.nombre ?? 'Choferes'}
                    <span className="block text-xs font-medium opacity-80">Choferes</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Cerrar menú"
                  className="tap-target -mr-2 -mt-1 flex items-center justify-center"
                >
                  <Icon name="x" size={22} />
                </button>
              </div>

              {(chofer || profile) && (
                <p className="mt-3 text-sm opacity-90">
                  {chofer?.nombre || profile?.nombre}
                  <span className="block text-xs opacity-75">Operador</span>
                </p>
              )}
            </div>

            <ul className="flex-1 overflow-y-auto py-2">
              {DRAWER_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3.5 px-5 py-3.5 text-[15px]',
                        isActive ? 'font-semibold text-brand-600' : 'text-ink',
                      )
                    }
                  >
                    <Icon name={link.icon} size={20} className="text-body-soft" />
                    <span className="flex-1">{link.label}</span>
                    {link.badge && <Badge tone="success">{link.badge}</Badge>}
                  </NavLink>
                </li>
              ))}

              <li className="mt-2 border-t border-gray-100 pt-2">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-3.5 px-5 py-3.5 text-[15px] text-ink"
                >
                  <Icon name="logout" size={20} className="text-body-soft" />
                  Cerrar sesión
                </button>
              </li>
            </ul>

            <p className="safe-bottom px-5 py-3 text-center text-xs text-body-soft">
              Versión {APP_VERSION}
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}

/** Cabecera de los asistentes paso a paso (check list / combustible). */
export function WizardHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-gray-100 bg-white">
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="tap-target flex items-center justify-center rounded-lg px-1 text-ink"
        >
          <Icon name="arrowLeft" size={22} />
        </button>
        <h1 className="flex-1 pr-9 text-center text-[17px] font-bold text-ink">{title}</h1>
      </div>
    </header>
  )
}
