import { useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore'

/** True once the persisted state has been loaded from localStorage, so the
 * UI can avoid flashing the fallback seed data for a frame on first paint. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useStore.persist.onFinishHydration(onChange),
    () => useStore.persist.hasHydrated(),
  )
}
