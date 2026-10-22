// Veszteség nélküli átköltöztetés valódi adatbázison: a teljes bemutató adatkészlet (minden
// adattípus) feltöltése egy üres cégbe, pontosan azokkal a kötegekkel és mentési hívásokkal, amiket
// a felület használ - majd rekordra pontos ellenőrzés, és egy második futtatás, ami semmit nem tölt
// fel kétszer.
import type pg from 'pg'
import { afterAll, beforeAll, expect, it, describe } from 'vitest'
import { CSOPORT_SORREND, atkoltoztetesiTerv, feltoltesiKotegek, type Csoport, type HelyiAdatok } from '../../src/lib/atkoltoztetes'
import { emptyBusinessSlices, mentesiTetel, valtozasokKiszamitasa } from '../../src/lib/remoteSync'
import { buildSeedData } from '../../src/store/seed'
import { DEFAULT_SETTINGS } from '../../src/types'
import { DB_URL, ment, ujAdatbazis, ujCeg, type TesztFelhasznalo } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip

let pool: pg.Pool
let ceg: TesztFelhasznalo

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('atkoltoztetes')
  ceg = await ujCeg(pool, 'Átköltöző Kft.')
})

afterAll(async () => {
  await pool?.end()
})

const TABLA: Record<Csoport, string> = {
  locations: 'locations',
  suppliers: 'suppliers',
  customers: 'customers',
  products: 'products',
  movements: 'movements',
  lots: 'purchase_lots',
  dailyClosings: 'daily_closings',
  ledgerEntries: 'ledger_entries',
  recurringLedgerEntries: 'recurring_ledger_entries',
  auditLog: 'audit_log',
}

async function szerverIdk(): Promise<Record<Csoport, Set<string>>> {
  const eredmeny = {} as Record<Csoport, Set<string>>
  for (const c of CSOPORT_SORREND) {
    const { rows } = await pool.query(`select id::text from public.${TABLA[c]} where company_id = $1`, [ceg.companyId])
    eredmeny[c] = new Set(rows.map((r) => r.id as string))
  }
  return eredmeny
}

async function feltoltKotegeket(helyi: HelyiAdatok, darab?: number) {
  const elotte = await szerverIdk()
  const szerver = { ...emptyBusinessSlices }
  for (const c of CSOPORT_SORREND) (szerver[c] as { id: string }[]) = [...elotte[c]].map((id) => ({ id }) as never)
  const terv = atkoltoztetesiTerv(helyi, szerver, false)
  const kotegek = feltoltesiKotegek(helyi, terv, new Set<Csoport>(CSOPORT_SORREND)).slice(0, darab)
  for (const koteg of kotegek) {
    const valtozasok = valtozasokKiszamitasa(ceg.companyId, emptyBusinessSlices, { ...emptyBusinessSlices, ...koteg })
    const tetel = mentesiTetel(ceg.companyId, valtozasok)
    await ment(pool, ceg.id, tetel.id, tetel.valtozasok)
  }
  return terv
}

const meret = (idk: Record<Csoport, Set<string>>) => Object.fromEntries(CSOPORT_SORREND.map((c) => [c, idk[c].size]))

leiras('átköltöztetés valódi adatbázisba', () => {
  const helyi: HelyiAdatok = { ...buildSeedData(), recurringLedgerEntries: [], settings: DEFAULT_SETTINGS }

  it('megszakadt átköltöztetés: az első kötegek után leáll, majd az újraindítás csak a hiányzót tölti fel', async () => {
    const terv = await feltoltKotegeket(helyi, 1)
    expect(terv.osszesen).toBeGreaterThan(300) // több köteg is kell hozzá
    const kozben = await szerverIdk()
    expect(kozben.movements.size).toBeLessThan(helyi.movements.length)

    const folytatas = await feltoltKotegeket(helyi)
    expect(folytatas.osszesen).toBe(terv.osszesen - 300)
  })

  it('a végén minden böngészős rekord a szerveren van, rekordra pontosan, és az adatok megegyeznek', async () => {
    const utana = await szerverIdk()
    for (const c of CSOPORT_SORREND) {
      for (const rekord of helyi[c] as { id: string }[]) expect(utana[c].has(rekord.id), `${c} ${rekord.id}`).toBe(true)
    }
    const termek = helyi.products[0]
    const t = (await pool.query('select name, current_stock, purchase_price, location_id::text from public.products where id = $1', [termek.id])).rows[0]
    expect({ name: t.name, stock: Number(t.current_stock), price: Number(t.purchase_price), loc: t.location_id }).toEqual({
      name: termek.name,
      stock: termek.currentStock,
      price: termek.purchasePrice,
      loc: termek.locationId,
    })
    const zaras = helyi.dailyClosings[0]
    const z = (await pool.query('select movement_ids from public.daily_closings where id = $1', [zaras.id])).rows[0]
    expect(z.movement_ids).toEqual(zaras.movementIds)
    const tetel = helyi.ledgerEntries[0]
    const l = (await pool.query('select amount, category, date::text from public.ledger_entries where id = $1', [tetel.id])).rows[0]
    expect({ amount: Number(l.amount), category: l.category, date: l.date }).toEqual({ amount: tetel.amount, category: tetel.category, date: tetel.date })
  })

  it('ugyanazzal a böngészőadattal megismételve semmit nem tölt fel kétszer', async () => {
    const elotte = meret(await szerverIdk())
    const terv = await feltoltKotegeket(helyi)
    expect(terv.osszesen).toBe(0)
    expect(meret(await szerverIdk())).toEqual(elotte)
  })
})
