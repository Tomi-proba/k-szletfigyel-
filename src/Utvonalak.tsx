// A Készlet útvonalai: önállóan a saját elrendezésével (Layout), a keretben a keret alatt (KeretLayout).
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RoleGate } from './components/RoleGate'
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
import { Approvals } from './pages/Approvals'
import { Jovahagyando } from './pages/Jovahagyando'

export function Utvonalak({ elrendezes }: { elrendezes: ReactElement }) {
  return (
    <Routes>
      <Route element={elrendezes}>
        <Route index element={<Dashboard />} />
        <Route path="keszlet" element={<Products />} />
        <Route path="mozgasnaplo" element={<Movements />} />
        <Route path="riasztasok" element={<Alerts />} />
        <Route
          path="beszallitok"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Suppliers />
            </RoleGate>
          }
        />
        <Route
          path="vevok"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Customers />
            </RoleGate>
          }
        />
        <Route
          path="telephelyek"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Locations />
            </RoleGate>
          }
        />
        <Route
          path="riportok"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Reports />
            </RoleGate>
          }
        />
        <Route
          path="penzugyi-naplo"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Ledger />
            </RoleGate>
          }
        />
        <Route
          path="afa"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Vat />
            </RoleGate>
          }
        />
        <Route path="napi-zaras" element={<DailyClosingPage />} />
        <Route path="jovahagyasra-var" element={<Jovahagyando />} />
        <Route
          path="napi-jelentesek"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <DailyReports />
            </RoleGate>
          }
        />
        <Route
          path="jovahagyasok"
          element={
            <RoleGate roles={['fo_iroda']}>
              <Approvals />
            </RoleGate>
          }
        />
        <Route
          path="audit-naplo"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <AuditLog />
            </RoleGate>
          }
        />
        <Route
          path="beallitasok"
          element={
            <RoleGate roles={['iroda', 'fo_iroda', 'tulajdonos']}>
              <Settings />
            </RoleGate>
          }
        />
        <Route
          path="elofizetes"
          element={
            <RoleGate roles={['iroda', 'fo_iroda']}>
              <Subscription />
            </RoleGate>
          }
        />
        <Route
          path="csapat"
          element={
            <RoleGate roles={['iroda', 'fo_iroda']}>
              <Team />
            </RoleGate>
          }
        />
        <Route path="admin" element={<Admin />} />
      </Route>
    </Routes>
  )
}
