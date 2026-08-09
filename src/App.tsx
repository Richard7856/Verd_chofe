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

function Gate() {
  const { session, chofer, loading, error, signOut } = useAuth()

  if (loading) return <Spinner label="Cargando…" />
  if (!session) return <Login />

  // Sesión válida pero el usuario no es chofer, o falló la carga del perfil.
  if (error || !chofer) {
    return (
      <div className="safe-top flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-accent-600">
          <Icon name="alert" size={30} />
        </span>
        <div>
          <p className="text-lg font-bold text-ink">No podemos abrir tu cuenta</p>
          <p className="mt-1 max-w-xs text-sm text-body-soft">{error}</p>
        </div>
        <Button block={false} variant="secondary" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
      </div>
    )
  }

  return (
    <SyncProvider>
      <TurnoProvider>
        <Routes>
          {/* Los asistentes ocupan la pantalla completa: sin tabs ni drawer,
              para que el chofer no se salga a mitad del registro. */}
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
