import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { SyncProvider } from '@/context/SyncContext'
import { TurnoProvider } from '@/context/TurnoContext'
import { AppShell } from '@/components/AppShell'
import { Button, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Login } from '@/screens/Login'
import { Home } from '@/screens/Home'
import { Records } from '@/screens/Records'
import { Unit } from '@/screens/Unit'
import { Profile } from '@/screens/Profile'
import { Incidents } from '@/screens/Incidents'
import { Settings } from '@/screens/Settings'
import { Documents, ServiceHistory } from '@/screens/Placeholder'
import { AperturaWizard } from '@/screens/checklist/AperturaWizard'
import { CierreWizard } from '@/screens/checklist/CierreWizard'
import { FuelWizard } from '@/screens/fuel/FuelWizard'

// El panel de administración es web y pesa; el chofer no tiene por qué
// descargarlo dentro del APK.
const AdminApp = lazy(() => import('@/admin/AdminApp'))

/** La app del chofer: tabs, drawer y asistentes a pantalla completa. */
function AppChofer() {
  return (
    <SyncProvider>
      <TurnoProvider>
        <Routes>
          <Route path="/checklist/apertura" element={<AperturaWizard />} />
          <Route path="/checklist/cierre" element={<CierreWizard />} />
          <Route path="/combustible" element={<FuelWizard />} />
          <Route path="/checklist" element={<Navigate to="/checklist/apertura" replace />} />

          <Route
            path="*"
            element={
              <AppShell>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/registros" element={<Records />} />
                  <Route path="/unidad" element={<Unit />} />
                  <Route path="/perfil" element={<Profile />} />
                  <Route path="/incidencias" element={<Incidents />} />
                  <Route path="/documentos" element={<Documents />} />
                  <Route path="/servicios" element={<ServiceHistory />} />
                  <Route path="/configuracion" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            }
          />
        </Routes>
      </TurnoProvider>
    </SyncProvider>
  )
}

function Gate() {
  const { session, chofer, esAdmin, loading, error, signOut } = useAuth()

  if (loading) return <Spinner label="Cargando…" />
  if (!session) return <Login />

  // El mismo usuario puede ser chofer, admin, o ninguno de los dos.
  if (error || (!chofer && !esAdmin)) {
    return (
      <div className="safe-top flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-accent-600">
          <Icon name="alert" size={30} />
        </span>
        <div>
          <p className="text-lg font-bold text-ink">No podemos abrir tu cuenta</p>
          <p className="mt-1 max-w-xs text-sm text-body-soft">
            {error ?? 'Tu usuario no está dado de alta como chofer ni como administrador.'}
          </p>
        </div>
        <Button block={false} variant="secondary" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
      </div>
    )
  }

  return (
    <Routes>
      {esAdmin && (
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<Spinner label="Cargando panel…" />}>
              <AdminApp />
            </Suspense>
          }
        />
      )}

      <Route
        path="*"
        element={chofer ? <AppChofer /> : <Navigate to="/admin" replace />}
      />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
