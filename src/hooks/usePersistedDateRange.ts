import { useEffect, useState } from 'react'
import { useKeretHaVan } from '@aweboldal/felulet'
import { keszletAlapIdoszak, tartomany } from '@aweboldal/modulok'

export interface DateRange {
  from: string
  to: string
}

function load(key: string, fallback: () => DateRange): DateRange {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.from === 'string' && typeof parsed?.to === 'string') return parsed
    }
  } catch {
    // ignore - localStorage can throw in private browsing etc.
  }
  return fallback()
}

function save(key: string, range: DateRange) {
  try {
    localStorage.setItem(key, JSON.stringify(range))
  } catch {
    // ignore
  }
}

/** A date-range filter (from/to) that survives navigating away from the
 * page and back - plain useState resets to the default every time the
 * component remounts (e.g. switching to another nav item and back), which
 * is what made a deliberately chosen date range "jump back" unexpectedly.
 * Persisted to localStorage, keyed per page so each page remembers its own
 * last-used range independently. Functional state updates keep two calls in
 * the same event handler (e.g. a quick-range button doing setFrom then
 * setTo) from clobbering each other's write. */
export function usePersistedDateRange(storageKey: string, defaultRange: () => DateRange) {
  // A közös keretben (AWEBOLDAL TERV.md F24 KS5) a dátumszűrő alapja a keret választott időszaka (ha nincs
  // választás, a Készlet alapértelmezése: a folyó hónap); a keret időszakának változásakor az új időszakra áll.
  const k = useKeretHaVan()
  const keretTartomany = k ? tartomany(k.idoszak(null, () => keszletAlapIdoszak())) : null
  const [range, setRangeState] = useState(() =>
    keretTartomany ? { from: keretTartomany.tol, to: keretTartomany.ig } : load(storageKey, defaultRange),
  )
  useEffect(() => {
    if (keretTartomany) setRangeState({ from: keretTartomany.tol, to: keretTartomany.ig })
  }, [keretTartomany?.tol, keretTartomany?.ig]) // eslint-disable-line react-hooks/exhaustive-deps

  function setRange(next: DateRange) {
    setRangeState(next)
    save(storageKey, next)
  }
  function setFrom(from: string) {
    setRangeState((prev) => {
      const next = { from, to: prev.to }
      save(storageKey, next)
      return next
    })
  }
  function setTo(to: string) {
    setRangeState((prev) => {
      const next = { from: prev.from, to }
      save(storageKey, next)
      return next
    })
  }

  return { from: range.from, to: range.to, setFrom, setTo, setRange }
}
