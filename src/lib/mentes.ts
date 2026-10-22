// Az alkalmazás egyetlen mentési sora (lásd lib/mentesiSor.ts) és annak állapota a felületnek.
import { create } from 'zustand'
import { MentesiSor, type SorAllapot } from './mentesiSor'
import { mentesiTetelKuldese } from './remoteSync'

const bongeszoTarolo = {
  getItem: (kulcs: string) => {
    try {
      return localStorage.getItem(kulcs)
    } catch {
      return null
    }
  },
  setItem: (kulcs: string, ertek: string) => {
    // Ha a böngésző tárolója nem írható (pl. megtelt), a sor attól még a memóriában működik tovább.
    try {
      localStorage.setItem(kulcs, ertek)
    } catch (hiba) {
      console.error('[mentes] a mentési sort nem sikerült a böngészőben is eltárolni', hiba)
    }
  },
}

export const mentesiSor = new MentesiSor(mentesiTetelKuldese, bongeszoTarolo, {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
  now: () => Date.now(),
})

export const useMentesAllapot = create<{ allapot: SorAllapot }>(() => ({ allapot: mentesiSor.aktualisAllapot }))
mentesiSor.figyel((allapot) => useMentesAllapot.setState({ allapot }))

if (typeof window !== 'undefined') {
  // Ha visszajön az internet, nem várjuk ki a következő újrapróbálást.
  window.addEventListener('online', () => mentesiSor.ujraprobal())
  // Nem mentett változásnál a böngésző rákérdez, valóban bezárja-e a lapot.
  window.addEventListener('beforeunload', (e) => {
    if (mentesiSor.fuggoTetelek.length > 0) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}
