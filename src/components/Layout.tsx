import {
  BarChart3,
  ChevronDown,
  History,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Scale,
  Settings as SettingsIcon,
  Truck,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAlerts } from '../hooks/useAlerts'
import { Modal } from './Modal'
import { MovementForm } from './MovementForm'

interface NavItem {
  to: string
  label: string
  badge?: boolean
}

interface NavGroup {
  key: string
  label: string
  icon: typeof LayoutDashboard
  items: NavItem[]
}

// Grouped so the sidebar reads as a handful of labeled sections instead of
// one long flat list. Every page has exactly one nav entry point - no two
// links point at the same page/filter combination. Nyitott eladások/
// Értékesítés was deliberately removed even though it wasn't an exact route
// duplicate: it only ever jumped to Riasztások's own "Nyitott eladás" filter
// chip, which is already reachable from the Riasztások page itself - a
// second, permanent shortcut to a filter the destination page already
// offers is the same kind of duplication as a repeated route.
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'attekintes',
    label: 'Áttekintés',
    icon: LayoutDashboard,
    items: [
      { to: '/', label: 'Kezdőlap' },
      { to: '/riasztasok', label: 'Riasztások', badge: true },
    ],
  },
  {
    key: 'keszlet',
    label: 'Készlet',
    icon: Package,
    items: [
      { to: '/keszlet', label: 'Termékek' },
      { to: '/mozgasnaplo', label: 'Mozgásnapló' },
    ],
  },
  {
    key: 'vevok',
    label: 'Vevők',
    icon: Users,
    items: [{ to: '/vevok', label: 'Vevők' }],
  },
  {
    key: 'beszallitok',
    label: 'Beszállítók',
    icon: Truck,
    items: [{ to: '/beszallitok', label: 'Beszállítók' }],
  },
  {
    key: 'penzugy',
    label: 'Pénzügy',
    icon: Scale,
    items: [
      { to: '/penzugyi-naplo', label: 'Pénzügyi napló' },
      { to: '/afa', label: 'ÁFA' },
      { to: '/riasztasok?szuro=fizetesi', label: 'Fizetési kötelezettségek' },
    ],
  },
  {
    key: 'riportok',
    label: 'Riportok',
    icon: BarChart3,
    items: [{ to: '/riportok', label: 'Riportok' }],
  },
  {
    key: 'elozmenyek',
    label: 'Előzmények',
    icon: History,
    items: [{ to: '/audit-naplo', label: 'Audit napló' }],
  },
  {
    key: 'beallitasok',
    label: 'Beállítások',
    icon: SettingsIcon,
    items: [
      { to: '/beallitasok', label: 'Beállítások' },
      { to: '/telephelyek', label: 'Telephelyek' },
    ],
  },
]

const EXPANDED_GROUPS_STORAGE_KEY = 'keszletfigyelo-nav-expanded-groups'

/** Riasztások has a filtered deep-link (?szuro=fizetesi) alongside its own
 * plain link - react-router's own NavLink only compares the pathname, which
 * would light up both at once. This compares the full path+query instead,
 * with a plain (query-less) link only counting as active when there's no
 * extra query narrowing the page to a more specific sibling link. */
function isItemActive(item: NavItem, pathname: string, search: string): boolean {
  const [itemPath, itemQuery] = item.to.split('?')
  if (pathname !== itemPath) return false
  if (!itemQuery) return search === ''
  const itemParams = new URLSearchParams(itemQuery)
  const currentParams = new URLSearchParams(search)
  return [...itemParams.entries()].every(([key, value]) => currentParams.get(key) === value)
}

function activeGroupKey(pathname: string, search: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => isItemActive(item, pathname, search))) return group.key
  }
  // Fall back to a same-page-different-query match so the right section
  // still opens even when the current URL doesn't exactly match any link
  // (e.g. a stray query param).
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => item.to.split('?')[0] === pathname)) return group.key
  }
  return null
}

function loadExpandedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    // ignore - localStorage can throw in private browsing etc.
  }
  return new Set(['attekintes'])
}

function saveExpandedGroups(groups: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify([...groups]))
  } catch {
    // ignore
  }
}

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [quickMoveOpen, setQuickMoveOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState(loadExpandedGroups)
  // Tracks which group we've already auto-expanded for, so switching pages
  // opens the new current group without fighting a user's manual collapse of
  // some other group. Adjusted directly during render (React's documented
  // pattern for deriving state from a prop change) instead of an effect, so
  // it takes effect in the same render as the navigation instead of a
  // follow-up one.
  const [lastAutoExpandedFor, setLastAutoExpandedFor] = useState<string | null>(null)
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
  const currentGroupKey = activeGroupKey(location.pathname, location.search)

  // Whichever group the current page belongs to always stays expanded on
  // arrival, even if the user hasn't touched the menu - so following a link
  // from the Dashboard or a cross-group shortcut never lands on a collapsed
  // section. Runs once per navigation to a new group; a later manual
  // collapse of that same group (without navigating elsewhere first) is left
  // alone.
  if (currentGroupKey && currentGroupKey !== lastAutoExpandedFor) {
    setLastAutoExpandedFor(currentGroupKey)
    if (!expandedGroups.has(currentGroupKey)) {
      const next = new Set(expandedGroups).add(currentGroupKey)
      setExpandedGroups(next)
      saveExpandedGroups(next)
    }
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveExpandedGroups(next)
      return next
    })
  }

  const navLinks = (onNavigate?: () => void) => (
    <nav className="flex flex-col gap-1">
      {NAV_GROUPS.map((group) => {
        const isOpen = expandedGroups.has(group.key)
        const isCurrentGroup = group.key === currentGroupKey
        const GroupIcon = group.icon
        return (
          <div key={group.key} className="mb-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={isOpen}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                isCurrentGroup && !isOpen ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]'
              } hover:bg-black/5`}
            >
              <span className="flex items-center gap-3">
                <GroupIcon size={18} />
                {group.label}
              </span>
              <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="ml-4 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-3">
                {group.items.map((item) => {
                  const isActive = isItemActive(item, location.pathname, location.search)
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text)] hover:bg-black/5'
                      }`}
                    >
                      {item.label}
                      {item.badge && alertCount > 0 && (
                        <span className="rounded-full bg-[var(--color-danger)] px-2 py-0.5 text-xs font-semibold text-white">
                          {alertCount}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
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
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:flex">
          <Link to="/" className="mb-6 px-2 text-lg font-bold text-[var(--color-text)]">
            Készletfigyelő
          </Link>
          {navLinks()}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
            <div className="relative flex h-full w-72 flex-col overflow-y-auto bg-[var(--color-surface)] p-4 shadow-xl">
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
