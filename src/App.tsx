import { Route, Routes } from 'react-router-dom'
import { useHydrated } from './hooks/useHydrated'
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
import { Settings } from './pages/Settings'

function App() {
  const hydrated = useHydrated()

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center text-[var(--color-text-muted)]">Betöltés…</div>
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="keszlet" element={<Products />} />
        <Route path="mozgasnaplo" element={<Movements />} />
        <Route path="riasztasok" element={<Alerts />} />
        <Route path="beszallitok" element={<Suppliers />} />
        <Route path="vevok" element={<Customers />} />
        <Route path="telephelyek" element={<Locations />} />
        <Route path="riportok" element={<Reports />} />
        <Route path="penzugyi-naplo" element={<Ledger />} />
        <Route path="beallitasok" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App
