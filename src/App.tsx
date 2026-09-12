import { Route, Routes } from 'react-router-dom'
import { useHydrated } from './hooks/useHydrated'
import { AuthGate } from './components/AuthGate'
import { RoleGate } from './components/RoleGate'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Products } from './pages/Products'
import { Movements } from './pages/Movements'
import { Alerts } from './pages/Alerts'
import { Suppliers } from './pages/Suppliers'
import { Customers } from './pages/Customers'
import { Locations } from './pages/Locations'
import { Reports } from './pages/Reports'
import { Ledger } from './pages/Ledger'
import { Vat } from './pages/Vat'
import { DailyClosingPage } from './pages/DailyClosing'
import { DailyReports } from './pages/DailyReports'
import { AuditLog } from './pages/AuditLog'
import { Settings } from './pages/Settings'
import { Subscription } from './pages/Subscription'
import { Admin } from './pages/Admin'
import { Team } from './pages/Team'

function App() {
  const hydrated = useHydrated()

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center text-[var(--color-text-muted)]">Betöltés…</div>
  }

  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="keszlet" element={<Products />} />
          <Route path="mozgasnaplo" element={<Movements />} />
          <Route path="riasztasok" element={<Alerts />} />
          <Route
            path="beszallitok"
            element={
              <RoleGate roles={['iroda']}>
                <Suppliers />
              </RoleGate>
            }
          />
          <Route
            path="vevok"
            element={
              <RoleGate roles={['iroda']}>
                <Customers />
              </RoleGate>
            }
          />
          <Route
            path="telephelyek"
            element={
              <RoleGate roles={['iroda']}>
                <Locations />
              </RoleGate>
            }
          />
          <Route
            path="riportok"
            element={
              <RoleGate roles={['iroda']}>
                <Reports />
              </RoleGate>
            }
          />
          <Route
            path="penzugyi-naplo"
            element={
              <RoleGate roles={['iroda']}>
                <Ledger />
              </RoleGate>
            }
          />
          <Route
            path="afa"
            element={
              <RoleGate roles={['iroda']}>
                <Vat />
              </RoleGate>
            }
          />
          <Route path="napi-zaras" element={<DailyClosingPage />} />
          <Route
            path="napi-jelentesek"
            element={
              <RoleGate roles={['iroda']}>
                <DailyReports />
              </RoleGate>
            }
          />
          <Route
            path="audit-naplo"
            element={
              <RoleGate roles={['iroda']}>
                <AuditLog />
              </RoleGate>
            }
          />
          <Route
            path="beallitasok"
            element={
              <RoleGate roles={['iroda']}>
                <Settings />
              </RoleGate>
            }
          />
          <Route
            path="elofizetes"
            element={
              <RoleGate roles={['iroda']}>
                <Subscription />
              </RoleGate>
            }
          />
          <Route
            path="csapat"
            element={
              <RoleGate roles={['iroda']}>
                <Team />
              </RoleGate>
            }
          />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}

export default App
