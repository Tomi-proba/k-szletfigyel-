import { useEffect } from 'react'
import { useHydrated } from './hooks/useHydrated'
import { useStore } from './store/useStore'
import { AuthGate } from './components/AuthGate'
import { Layout } from './components/Layout'
import { Utvonalak } from './Utvonalak'
import { AsztaliAdatMento } from './components/AsztaliAdatMento'

function App() {
  const hydrated = useHydrated()

  // Local ("nem Supabase-hez kötött") módban két fül/ablak a SAJÁT böngésző
  // ugyanazon localStorage-át olvassa, de Zustand persist alapból csak
  // induláskor tölti be azt - egy másik fülön történt mentés nélküle csak
  // frissítés után látszana. Ez tette lehetővé pl. a `?demo_szerepkor=`
  // ideiglenes szerepkör-szimulációt (lásd useAuth.tsx) két fülben, közös
  // adaton, valós idejű frissüléssel - de általánosan is hasznos: ugyanaz a
  // gép/böngésző, két megnyitott fül esete a valódi (nem demó) használatban
  // is előfordulhat.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      // Csak helyi ("nem Supabase-hez kötött") módban rehidrálunk - ha ez a
      // fül épp remote módban van (valódi Supabase-munkamenet), a
      // localStorage-ban lévő pillanatkép mindig "local"-nak van jelölve
      // üres üzleti adattal (lásd useStore.ts partialize) - egy ilyen
      // eseményre rehidrálni kilökné ezt a fület a saját remote
      // állapotából. Remote módban a fülek közti frissülésről a Supabase
      // gondoskodik, nem a localStorage.
      if (e.key === 'keszletfigyelo-storage' && e.newValue && useStore.getState().dataMode !== 'remote') {
        useStore.persist.rehydrate()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Minden app-indításkor leellenőrizzük, nincs-e esedékessé vált, még le
  // nem könyvelt ismétlődő napló tétel (lásd store/useStore.ts
  // generateDueRecurringLedgerEntries) - így a dashboard/pénzügyi napló
  // mindig naprakész, akkor is, ha a felhasználó meg sem nyitja a
  // Pénzügyi napló oldalt. Csak hidratálás UTÁN fut (a store ekkor már a
  // valós, mentett ismétlődő tételeket tartalmazza, nem az üres kezdeti
  // állapotot).
  useEffect(() => {
    if (!hydrated) return
    useStore.getState().generateDueRecurringLedgerEntries()
  }, [hydrated])

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center text-[var(--color-text-muted)]">Betöltés…</div>
  }

  return (
    <AuthGate>
      <AsztaliAdatMento />
      <Utvonalak elrendezes={<Layout />} />
    </AuthGate>
  )
}

export default App
