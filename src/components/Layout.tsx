import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  History,
  LayoutDashboard,
  Menu,
  MapPin,
  Package,
  Plus,
  Scale,
  Settings as SettingsIcon,
  Truck,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAlerts } from '../hooks/useAlerts'
import { Modal } from './Modal'
import { MovementForm } from './MovementForm'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
  badge?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Kezdőlap', icon: LayoutDashboard, end: true },
  { to: '/keszlet', label: 'Készlet', icon: Package },
  { to: '/mozgasnaplo', label: 'Mozgásnapló', icon: ClipboardList },
  { to: '/riasztasok', label: 'Riasztások', icon: AlertTriangle, badge: true },
  { to: '/beszallitok', label: 'Beszállítók', icon: Truck },
  { to: '/vevok', label: 'Vevők', icon: Users },
  { to: '/telephelyek', label: 'Telephelyek', icon: MapPin },
  { to: '/riportok', label: 'Riportok', icon: BarChart3 },
  { to: '/penzugyi-naplo', label: 'Pénzügyi napló', icon: Scale },
  { to: '/audit-naplo', label: 'Audit napló', icon: History },
  { to: '/beallitasok', label: 'Beállítások', icon: SettingsIcon },
]

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [quickMoveOpen, setQuickMoveOpen] = useState(false)
  const alerts = useAlerts()
  const alertCount =
    alerts.needsReorder.length +
    alerts.slowMoving.length +
    alerts.transferSuggestions.length +
    alerts.unpaidSales.length +
    alerts.urgentPayables.length +
    alerts.openSales.length
  const location = useLocation()
  const isDashboard = location.pathname === '/'

  const navLinks = (onNavigate?: () => void) => (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text)] hover:bg-black/5'
            }`
          }
        >
          <span className="flex items-center gap-3">
            <Icon size={18} />
            {label}
          </span>
          {badge && alertCount > 0 && (
            <span className="rounded-full bg-[var(--color-danger)] px-2 py-0.5 text-xs font-semibold text-white">{alertCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Menü"
          className="rounded-lg p-2 text-[var(--color-text)] hover:bg-black/5"
        >
          <Menu size={22} />
        </button>
        <span className="font-semibold text-[var(--color-text)]">Készletfigyelő</span>
        <div className="w-9" />
      </header>

      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:flex">
          <div className="mb-6 px-2 text-lg font-bold text-[var(--color-text)]">Készletfigyelő</div>
          {navLinks()}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
            <div className="relative flex h-full w-72 flex-col bg-[var(--color-surface)] p-4 shadow-xl">
              <div className="mb-6 flex items-center justify-between px-2">
                <span className="text-lg font-bold text-[var(--color-text)]">Készletfigyelő</span>
                <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Bezárás" className="rounded-lg p-2 hover:bg-black/5">
                  <X size={20} />
                </button>
              </div>
              {navLinks(() => setDrawerOpen(false))}
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 pb-28 sm:px-6 md:pb-10">
          <Outlet />
        </main>
      </div>

      {!isDashboard && (
        <button
          type="button"
          onClick={() => setQuickMoveOpen(true)}
          aria-label="Új mozgás rögzítése"
          className="fixed bottom-6 right-5 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          <Plus size={28} />
        </button>
      )}

      {quickMoveOpen && (
        <Modal title="Mozgás rögzítése" onClose={() => setQuickMoveOpen(false)}>
          <MovementForm onDone={() => setQuickMoveOpen(false)} />
        </Modal>
      )}
    </div>
  )
}
