// A szerveroldali mentés (public.keszlet_mentes) és a jogosultságok tesztjei valódi PostgreSQL-en.
// Futtatás: KESZLET_TEST_DATABASE_URL=postgresql://…/keszlet_test npm test
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, hibakod, ment, nevebenFut, ujAdatbazis, ujCeg, ujCsapattag, type TesztFelhasznalo, type Valtozas } from './adatbazis'

const leiras = DB_URL ? describe : describe.skip

let pool: pg.Pool
let ceg: TesztFelhasznalo

beforeAll(async () => {
  if (!DB_URL) return
  pool = await ujAdatbazis('mentes')
  ceg = await ujCeg(pool)
})

afterAll(async () => {
  await pool?.end()
})

function termek(companyId: string, locationId: string, felulirt: Record<string, unknown> = {}): Valtozas {
  return {
    tabla: 'products',
    sor: {
      id: randomUUID(),
      company_id: companyId,
      location_id: locationId,
      name: 'Bejárati ajtó',
      category: 'Ajtó',
      unit: 'db',
      current_stock: 0,
      min_stock: 1,
      purchase_price: 1000,
      sale_price: 2000,
      created_at: '2026-10-23T08:00:00Z',
      updated_at: '2026-10-23T08:00:00Z',
      version: null,
      ...felulirt,
    },
  }
}

function naplo(companyId: string, leirasSzoveg: string): Valtozas {
  return {
    tabla: 'audit_log',
    sor: {
      id: randomUUID(),
      company_id: companyId,
      event_timestamp: '2026-10-23T08:00:00Z',
      entity_type: 'product',
      entity_id: 'x',
      entity_label: 'Bejárati ajtó',
      action: 'create',
      description: leirasSzoveg,
    },
  }
}

const darab = async (tabla: string, companyId: string) =>
  Number((await pool.query(`select count(*) from public.${tabla} where company_id = $1`, [companyId])).rows[0].count)

leiras('egy művelet = egy mentés', () => {
  it('a köteg minden sora egy tranzakcióban mentődik, az új sorok 1-es verziót kapnak', async () => {
    const t = termek(ceg.companyId, ceg.locationId!)
    const eredmeny = await ment(pool, ceg.id, randomUUID(), [t, naplo(ceg.companyId, 'Termék létrehozva')])
    expect(eredmeny).toEqual([{ tabla: 'products', id: t.sor.id, version: 1 }])
    const sor = (await pool.query('select name, version from public.products where id = $1', [t.sor.id])).rows[0]
    expect(sor).toEqual({ name: 'Bejárati ajtó', version: 1 })
  })

  it('ugyanaz a köteg másodszor elküldve nem hat még egyszer (elveszett válasz utáni újraküldés)', async () => {
    const t = termek(ceg.companyId, ceg.locationId!)
    const koteg = randomUUID()
    const valtozasok = [t, naplo(ceg.companyId, 'Kétszer küldött köteg')]
    const elso = await ment(pool, ceg.id, koteg, valtozasok)
    const masodik = await ment(pool, ceg.id, koteg, valtozasok)
    expect(masodik).toEqual(elso)
    const naplok = await pool.query("select count(*) from public.audit_log where description = 'Kétszer küldött köteg'")
    expect(Number(naplok.rows[0].count)).toBe(1)
    expect((await pool.query('select version from public.products where id = $1', [t.sor.id])).rows[0].version).toBe(1)
  })

  it('ha a köteg bármelyik sora hibás, semmi nem mentődik belőle', async () => {
    const elotte = await darab('products', ceg.companyId)
    const jo = termek(ceg.companyId, ceg.locationId!)
    const rosszMozgas: Valtozas = {
      tabla: 'movements',
      sor: { id: randomUUID(), company_id: ceg.companyId, product_id: randomUUID(), location_id: ceg.locationId, date: '2026-10-23', type: 'out', quantity: 1 },
    }
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [jo, rosszMozgas]))).toBe('23503')
    expect(await darab('products', ceg.companyId)).toBe(elotte)
  })

  it('az audit napló bejegyzése sosem íródik felül', async () => {
    const n = naplo(ceg.companyId, 'Eredeti leírás')
    await ment(pool, ceg.id, randomUUID(), [n])
    await ment(pool, ceg.id, randomUUID(), [{ tabla: 'audit_log', sor: { ...n.sor, description: 'Hamisított leírás' } }])
    expect((await pool.query('select description from public.audit_log where id = $1', [n.sor.id])).rows[0].description).toBe('Eredeti leírás')
  })

  it('tömböt és JSON-t is helyesen ment (napi zárás, beállítások)', async () => {
    const zaras: Valtozas = {
      tabla: 'daily_closings',
      sor: {
        id: randomUUID(),
        company_id: ceg.companyId,
        location_id: ceg.locationId,
        date: '2026-10-22',
        submitted_at: '2026-10-22T18:00:00Z',
        status: 'submitted',
        in_count: 1,
        out_count: 0,
        product_breakdown: [{ productId: 'p1', productName: 'Ajtó', unit: 'db', inQuantity: 1, outQuantity: 0 }],
        movement_ids: ['m1', 'm2'],
        created_at: '2026-10-22T18:00:00Z',
        version: null,
      },
    }
    const beallitas: Valtozas = {
      tabla: 'company_settings',
      sor: { id: ceg.companyId, company_id: ceg.companyId, settings: { costingMethod: 'fifo' }, ledger_categories: ['ÁFA', 'Bérleti díj'], version: null },
    }
    await ment(pool, ceg.id, randomUUID(), [zaras, beallitas])
    const z = (await pool.query('select movement_ids, product_breakdown from public.daily_closings where id = $1', [zaras.sor.id])).rows[0]
    expect(z.movement_ids).toEqual(['m1', 'm2'])
    expect(z.product_breakdown[0].productName).toBe('Ajtó')
    const b = (await pool.query('select settings, ledger_categories from public.company_settings where id = $1', [ceg.companyId])).rows[0]
    expect(b).toEqual({ settings: { costingMethod: 'fifo' }, ledger_categories: ['ÁFA', 'Bérleti díj'] })
  })

  it('ismeretlen táblát nem fogad el', async () => {
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'profiles', sor: { company_id: ceg.companyId } }]))).toBe('22023')
  })
})

leiras('ütközésvédelem (verziószám)', () => {
  it('a sorrendben, a legfrissebb verzióval érkező módosítások mind érvényesek', async () => {
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    const [v2] = await ment(pool, ceg.id, randomUUID(), [{ tabla: 'products', sor: { ...t.sor, current_stock: 5, version: 1 } }])
    const [v3] = await ment(pool, ceg.id, randomUUID(), [{ tabla: 'products', sor: { ...t.sor, current_stock: 3, version: v2.version } }])
    expect([v2.version, v3.version]).toEqual([2, 3])
    expect(Number((await pool.query('select current_stock from public.products where id = $1', [t.sor.id])).rows[0].current_stock)).toBe(3)
  })

  it('egy régebbi adatból készült módosítás nem írja felül csendben a másik eszköz mentését', async () => {
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    // „A” eszköz: 10 db-ra állítja (1 → 2. verzió)
    await ment(pool, ceg.id, randomUUID(), [{ tabla: 'products', sor: { ...t.sor, current_stock: 10, version: 1 } }])
    // „B” eszköz még az 1. verziót látja, és 7-re állítaná
    const nemMentett = naplo(ceg.companyId, 'B eszköz módosítása')
    const kod = await hibakod(ment(pool, ceg.id, randomUUID(), [{ tabla: 'products', sor: { ...t.sor, current_stock: 7, version: 1 } }, nemMentett]))
    expect(kod).toBe('KF409')
    expect(Number((await pool.query('select current_stock from public.products where id = $1', [t.sor.id])).rows[0].current_stock)).toBe(10)
    // a köteg többi része (a naplóbejegyzés) sem mentődött
    expect((await pool.query('select count(*) from public.audit_log where id = $1', [nemMentett.sor.id])).rows[0].count).toBe('0')
  })

  it('a felületen kívüli, verziót nem küldő módosítás is növeli a verziót', async () => {
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    await pool.query('update public.products set name = $2 where id = $1', [t.sor.id, 'Átnevezve'])
    expect((await pool.query('select version from public.products where id = $1', [t.sor.id])).rows[0].version).toBe(2)
  })
})

leiras('jogosultságok', () => {
  it('bejelentkezés nélkül nem lehet menteni', async () => {
    expect(await hibakod(ment(pool, randomUUID(), randomUUID(), []))).toBe('42501')
  })

  it('másik cég adatát nem lehet menteni', async () => {
    const masik = await ujCeg(pool, 'Másik Kft.')
    expect(await hibakod(ment(pool, ceg.id, randomUUID(), [termek(masik.companyId, masik.locationId!)]))).toBe('42501')
  })

  it('a raktáros látja a vevőket, a beszállítókat és a beállításokat, de nem rögzíthet vevőt, és a pénzügyi naplót nem látja', async () => {
    const vevo: Valtozas = { tabla: 'customers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Kovács Bt.', version: null } }
    const szallito: Valtozas = { tabla: 'suppliers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Ablak Kft.', lead_time_days: 7, version: null } }
    const tetel: Valtozas = {
      tabla: 'ledger_entries',
      sor: { id: randomUUID(), company_id: ceg.companyId, date: '2026-10-23', type: 'expense', category: 'Bérleti díj', amount: 100000, version: null },
    }
    await ment(pool, ceg.id, randomUUID(), [vevo, szallito, tetel])

    const raktaros = await ujCsapattag(pool, ceg, 'raktaros')
    const lat = await nevebenFut(pool, raktaros.id, async (db) => ({
      vevok: (await db.query('select count(*) from public.customers')).rows[0].count,
      szallitok: (await db.query('select count(*) from public.suppliers')).rows[0].count,
      beallitasok: (await db.query('select count(*) from public.company_settings')).rows[0].count,
      naplo: (await db.query('select count(*) from public.ledger_entries')).rows[0].count,
    }))
    expect(Number(lat.vevok)).toBeGreaterThan(0)
    expect(Number(lat.szallitok)).toBeGreaterThan(0)
    expect(Number(lat.beallitasok)).toBe(1)
    expect(Number(lat.naplo)).toBe(0)

    const ujVevo: Valtozas = { tabla: 'customers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Raktáros vevője', version: null } }
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [ujVevo]))).toBe('42501')
  })

  it('a raktáros a saját telephelye termékének készletét frissítheti (pl. beérkezés jóváhagyásakor), más telephelyét nem', async () => {
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    const raktaros = await ujCsapattag(pool, ceg, 'raktaros')
    const [eredmeny] = await ment(pool, raktaros.id, randomUUID(), [
      { tabla: 'products', sor: { ...t.sor, current_stock: 8, version: 1 } },
      naplo(ceg.companyId, 'Raktáros: beérkezés jóváhagyva'),
    ])
    expect(eredmeny.version).toBe(2)

    const masikHely = (await pool.query("insert into public.locations (company_id, name) values ($1, 'Másik telephely') returning id", [ceg.companyId])).rows[0].id
    const m = termek(ceg.companyId, masikHely)
    await ment(pool, ceg.id, randomUUID(), [m])
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'products', sor: { ...m.sor, current_stock: 8, version: 1 } }]))).not.toBeNull()
    expect(Number((await pool.query('select current_stock from public.products where id = $1', [m.sor.id])).rows[0].current_stock)).toBe(0)
  })

  it('a raktáros lezárt napra is rögzíthet mozgást (a zárás „utólag módosítva” jelzést kap), de a zárást nem hagyhatja jóvá', async () => {
    const raktaros = await ujCsapattag(pool, ceg, 'raktaros')
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    const zaras: Valtozas = {
      tabla: 'daily_closings',
      sor: {
        id: randomUUID(),
        company_id: ceg.companyId,
        location_id: ceg.locationId,
        date: '2026-10-21',
        submitted_at: '2026-10-21T18:00:00Z',
        status: 'submitted',
        in_count: 1,
        out_count: 0,
        product_breakdown: [],
        movement_ids: [],
        created_at: '2026-10-21T18:00:00Z',
        version: null,
      },
    }
    await ment(pool, raktaros.id, randomUUID(), [zaras])
    const mozgas: Valtozas = {
      tabla: 'movements',
      sor: { id: randomUUID(), company_id: ceg.companyId, product_id: t.sor.id, location_id: ceg.locationId, date: '2026-10-21', type: 'in', quantity: 1, version: null },
    }
    const jelzes: Valtozas = { tabla: 'daily_closings', sor: { ...zaras.sor, modified_after_submission: true, last_modified_at: '2026-10-21T19:00:00Z', version: 1 } }
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [mozgas, jelzes]))).toBeNull()
    const z = (await pool.query('select modified_after_submission, status from public.daily_closings where id = $1', [zaras.sor.id])).rows[0]
    expect(z).toEqual({ modified_after_submission: true, status: 'submitted' })

    const jovahagyas: Valtozas = { tabla: 'daily_closings', sor: { ...jelzes.sor, status: 'approved', approved_at: '2026-10-21T20:00:00Z', version: 2 } }
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [jovahagyas]))).toBe('42501')
    expect((await pool.query('select status from public.daily_closings where id = $1', [zaras.sor.id])).rows[0].status).toBe('submitted')
  })

  it('a tulajdonos mindent lát, de semmit nem írhat', async () => {
    const tulajdonos = await ujCsapattag(pool, ceg, 'tulajdonos')
    const naplo = await nevebenFut(pool, tulajdonos.id, async (db) => (await db.query('select count(*) from public.ledger_entries')).rows[0].count)
    expect(Number(naplo)).toBeGreaterThan(0)
    expect(await hibakod(ment(pool, tulajdonos.id, randomUUID(), [termek(ceg.companyId, ceg.locationId!)]))).toBe('42501')
    const vevo: Valtozas = { tabla: 'customers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Tulajdonos vevője', version: null } }
    expect(await hibakod(ment(pool, tulajdonos.id, randomUUID(), [vevo]))).toBe('42501')
  })

  it('az iroda mozgást rögzíthet, és ehhez a termék készlete is frissül; a termék nevét nem módosíthatja', async () => {
    const iroda = await ujCsapattag(pool, ceg, 'iroda')
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    const mozgas: Valtozas = {
      tabla: 'movements',
      sor: { id: randomUUID(), company_id: ceg.companyId, product_id: t.sor.id, location_id: ceg.locationId, date: '2026-10-23', type: 'in', quantity: 4, version: null },
    }
    const keszlet: Valtozas = { tabla: 'products', sor: { ...t.sor, current_stock: 4, purchase_price: 1100, updated_at: '2026-10-23T09:00:00Z', version: 1 } }
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [keszlet, mozgas, naplo(ceg.companyId, 'Iroda: beérkezés')]))).toBeNull()
    expect(Number((await pool.query('select current_stock from public.products where id = $1', [t.sor.id])).rows[0].current_stock)).toBe(4)

    const atnevezes: Valtozas = { tabla: 'products', sor: { ...keszlet.sor, name: 'Átnevezett', version: 2 } }
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [atnevezes]))).toBe('42501')
    expect((await pool.query('select name from public.products where id = $1', [t.sor.id])).rows[0].name).toBe('Bejárati ajtó')
  })

  it('a raktáros sem módosíthatja a termék törzsadatát (eladási ár)', async () => {
    const raktaros = await ujCsapattag(pool, ceg, 'raktaros')
    const t = termek(ceg.companyId, ceg.locationId!)
    await ment(pool, ceg.id, randomUUID(), [t])
    expect(await hibakod(ment(pool, raktaros.id, randomUUID(), [{ tabla: 'products', sor: { ...t.sor, sale_price: 1, version: 1 } }]))).toBe('42501')
  })

  it('az iroda vevőt és naplótételt rögzíthet', async () => {
    const iroda = await ujCsapattag(pool, ceg, 'iroda')
    const vevo: Valtozas = { tabla: 'customers', sor: { id: randomUUID(), company_id: ceg.companyId, name: 'Iroda vevője', version: null } }
    expect(await hibakod(ment(pool, iroda.id, randomUUID(), [vevo]))).toBeNull()
  })
})
