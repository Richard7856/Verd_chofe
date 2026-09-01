import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './AdminShell'
import { Resumen } from './pages/Resumen'
import { Turnos } from './pages/Turnos'
import { ReporteChofer } from './pages/ReporteChofer'
import { Choferes } from './pages/Choferes'
import { Unidades } from './pages/Unidades'
import { Combustible } from './pages/Combustible'
import { Gastos } from './pages/Gastos'
import { Incidencias } from './pages/Incidencias'
import { Avisos } from './pages/Avisos'

/**
 * Panel web de administración. Se carga de forma diferida desde App.tsx: el
 * chofer nunca lo descarga, así que no engorda el APK ni la PWA del celular.
 *
 * No lleva verificación de rol propia — la hace el enrutador antes de montarlo,
 * y RLS es lo que realmente protege los datos.
 */
export default function AdminApp() {
  return (
    <AdminShell>
      <Routes>
        <Route path="/" element={<Resumen />} />
        <Route path="/turnos" element={<Turnos />} />
        <Route path="/reporte" element={<ReporteChofer />} />
        <Route path="/choferes" element={<Choferes />} />
        <Route path="/unidades" element={<Unidades />} />
        <Route path="/combustible" element={<Combustible />} />
        <Route path="/gastos" element={<Gastos />} />
        <Route path="/incidencias" element={<Incidencias />} />
        <Route path="/avisos" element={<Avisos />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminShell>
  )
}
