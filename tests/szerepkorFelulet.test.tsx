// @vitest-environment jsdom
// Raktáros és fő iroda munkamegosztása a felületen (AWEBOLDAL TERV.md F28): a raktáros menüjében nincs
// Mozgásnapló és Riasztások, az útvonalaik zárva előle; a napi zárást csak a raktáros küldi be, az iroda és a fő
// iroda nem (csak megtekinti és jóváhagyja). A szerepkört a helyi mód ?demo_szerepkor= kapcsolója adja.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../src/hooks/useAuth'
import { Layout } from '../src/components/Layout'
import { Utvonalak } from '../src/Utvonalak'
import { useStore } from '../src/store/useStore'
const store = () => useStore.getState()
import type { UserRole } from '../src/types/auth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let gyoker: Root
let tarolo: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  useStore.getState().clearAllData()
  tarolo = document.createElement('div')
  document.body.appendChild(tarolo)
})

afterEach(() => {
  act(() => gyoker.unmount())
  tarolo.remove()
})

async function megnyit(szerep: UserRole, utvonal: string) {
  window.history.replaceState(null, '', `/?demo_szerepkor=${szerep}`)
  // Minden menücsoport nyitva, hogy az összes pont látsszon.
  localStorage.setItem('keszletfigyelo-nav-expanded-groups', JSON.stringify(['attekintes', 'keszlet', 'partnerek', 'penzugy', 'elozmenyek', 'beallitasok', 'fiok']))
  gyoker = createRoot(tarolo)
  await act(async () => {
    gyoker.render(
      <AuthProvider>
        <MemoryRouter initialEntries={[utvonal]}>
          <Utvonalak elrendezes={<Layout />} />
        </MemoryRouter>
      </AuthProvider>,
    )
  })
}

const menuPontok = () => [...tarolo.querySelectorAll('nav a')].map((a) => a.textContent?.trim() ?? '')
const gombok = () => [...tarolo.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')

describe('szerepkörök a felületen (F28)', () => {
  it('a raktáros menüjében nincs Mozgásnapló és Riasztások', async () => {
    await megnyit('raktaros', '/')
    const m = menuPontok().join(' | ')
    expect(m).toContain('Napi zárás')
    expect(m).toContain('Termékek')
    expect(m).not.toContain('Mozgásnapló')
    expect(m).not.toContain('Riasztások')
    expect(tarolo.textContent).not.toContain('Alacsony készlet')
  })

  it.each(['/mozgasnaplo', '/riasztasok'])('a raktáros a %s útvonalat közvetlenül sem nyithatja meg', async (ut) => {
    await megnyit('raktaros', ut)
    expect(tarolo.querySelector('h1')?.textContent ?? '').not.toMatch(/Mozgásnapló|Riasztások/)
  })

  it('a fő iroda menüjében megvan a Mozgásnapló és a Riasztások', async () => {
    await megnyit('fo_iroda', '/')
    const m = menuPontok().join(' | ')
    expect(m).toContain('Mozgásnapló')
    expect(m).toContain('Riasztások')
  })

  it.each<UserRole>(['fo_iroda', 'iroda'])('%s: a napi zárást nem küldheti be, csak megtekinti', async (szerep) => {
    await megnyit(szerep, '/napi-zaras')
    expect(gombok()).not.toContain('Napi zárás elküldése')
    expect(tarolo.querySelector('[data-csak-raktaros-zarhat]')).not.toBeNull()
  })

  it('a raktáros beküldheti a napi zárást', async () => {
    await megnyit('raktaros', '/napi-zaras')
    expect(gombok()).toContain('Napi zárás elküldése')
    expect(tarolo.querySelector('[data-csak-raktaros-zarhat]')).toBeNull()
  })

  it('a raktárosnak nincs Partnerek (Vevők, Szállítók) menüje (F30)', async () => {
    await megnyit('raktaros', '/')
    const m = menuPontok().join(' | ')
    expect(m).not.toContain('Vevők')
    expect(m).not.toContain('Szállítók')
  })

  it('a raktáros kiadásnál Magánszemély vagy Partner; Partnernél kötelező listából választani (F30)', async () => {
    store().addCustomer({ name: 'Kovács Építő Kft.', paymentTermDays: 15 })
    await megnyit('raktaros', '/')
    const gomb = (cim: string) => [...tarolo.querySelectorAll('button')].find((b) => b.textContent?.trim() === cim)!
    await act(async () => gomb('Kimenő').click())
    expect(gomb('Magánszemély')).toBeTruthy()
    expect(tarolo.querySelector('[data-partner-valaszto]')).toBeNull()
    await act(async () => gomb('Partner').click())
    const lista = tarolo.querySelector<HTMLSelectElement>('[data-partner-valaszto]')!
    expect([...lista.options].map((o) => o.textContent)).toContain('Kovács Építő Kft.')
    // A raktáros csak a nevet látja: határidő, tartozás nincs a listában.
    expect(lista.textContent).not.toMatch(/nap|Ft/)
  })

  it('F33: a fő iroda bejövőnél látja „A raktáros jóváhagyása szükséges” pipát, alapból bepipálva; a raktáros nem', async () => {
    await megnyit('fo_iroda', '/')
    const gomb = (cim: string) => [...tarolo.querySelectorAll('button')].find((b) => b.textContent?.trim() === cim)!
    await act(async () => gomb('Bejövő').click())
    const pipa = tarolo.querySelector<HTMLInputElement>('[data-raktar-jovahagyas] input[type="checkbox"]')!
    expect(pipa.checked).toBe(true)
    expect(gombok()).toContain('Küldés a raktárnak')
    await act(async () => pipa.click())
    expect(gombok()).toContain('Mentés')
  })

  it('F33: a bejövő rendelés egyetlen helye az „Új mozgás” (Szállítóval); külön „Rendelés leadása” gomb nincs', async () => {
    await megnyit('fo_iroda', '/')
    const gomb = (cim: string) => [...tarolo.querySelectorAll('button')].find((b) => b.textContent?.trim() === cim)!
    await act(async () => gomb('Bejövő').click())
    expect(tarolo.querySelector('[data-szallito-valaszto]')).not.toBeNull()
    act(() => gyoker.unmount())
    await megnyit('fo_iroda', '/mozgasnaplo')
    expect(gombok().some((g) => /Rendelés leadása/.test(g))).toBe(false)
  })

  it('F33: a raktáros nem látja a „raktáros jóváhagyása” pipát', async () => {
    await megnyit('raktaros', '/')
    const gomb = (cim: string) => [...tarolo.querySelectorAll('button')].find((b) => b.textContent?.trim() === cim)!
    await act(async () => gomb('Bejövő').click())
    expect(tarolo.querySelector('[data-raktar-jovahagyas]')).toBeNull()
  })
})
