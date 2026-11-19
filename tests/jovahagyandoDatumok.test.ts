// A jóváhagyandó tételek várható dátumai (beérkezés, fizetés) – a felhasználó kérése, minden szerepnél.
import { describe, expect, it } from 'vitest'
import { jovahagyandoDatumok, napHozzaad } from '../src/lib/jovahagyandoDatumok'
import type { Customer, Movement, Supplier } from '../src/types'

const MA = '2026-11-19'
const m = (x: Partial<Movement>) => ({ id: 'm', productId: 'p', locationId: 'l', date: '2026-11-18', quantity: 10, createdAt: '', ...x }) as Movement
const szallito = (x: Partial<Supplier>) => ({ id: 's', name: 'Nagyker', leadTimeDays: 0, ...x }) as Supplier
const vevo = (x: Partial<Customer>) => ({ id: 'c', name: 'Vevő', ...x }) as Customer

describe('jóváhagyandó tételek várható dátumai', () => {
  it('rendelt áru: várható beérkezés a szállítási idő szerint, fizetés a szállító határideje szerint', () => {
    const sorok = jovahagyandoDatumok(m({ type: 'in', approvalStatus: 'pending' }), { szallito: szallito({ leadTimeDays: 3, paymentTermDays: 8 }), beszerzes: true, ma: MA })
    expect(sorok).toEqual([
      { cim: 'Várható beérkezés', datum: '2026-11-21', megjegyzes: 'a szállító 3 napos szállítási ideje szerint', lejart: undefined },
      { cim: 'Várható fizetés', datum: '2026-11-26', megjegyzes: 'a szállító 8 napos fizetési határideje szerint', lejart: undefined },
    ])
  })

  it('késő rendelés: „késik”; megadott határidő a tételen elsőbbséget kap; lejárt fizetés', () => {
    const sorok = jovahagyandoDatumok(m({ type: 'in', date: '2026-11-10', dueDate: '2026-11-15' }), { szallito: szallito({ leadTimeDays: 2, paymentTermDays: 30 }), beszerzes: true, ma: MA })
    expect(sorok[0]).toMatchObject({ cim: 'Várható beérkezés', datum: '2026-11-12', lejart: 'késik' })
    expect(sorok[1]).toMatchObject({ cim: 'Várható fizetés', datum: '2026-11-15', lejart: 'lejárt' })
  })

  it('a raktár visszaigazolta: beérkezett; szállítói határidő nélkül kiírja, hogy nincs megadva', () => {
    const sorok = jovahagyandoDatumok(m({ type: 'in', raktarVisszaigazolva: '2026-11-19T08:00:00Z', raktarMennyiseg: 10 }), { szallito: szallito({}), beszerzes: true, ma: MA })
    expect(sorok[0]).toEqual({ cim: 'Beérkezett', datum: '2026-11-19', megjegyzes: 'a raktár visszaigazolta' })
    expect(sorok[1]).toMatchObject({ datum: null, megjegyzes: 'nincs megadva (a szállító fizetési határideje nincs beállítva)' })
  })

  it('kiadás vevőnek: kiadás napja és várható fizetés a vevő határideje szerint; fizetett; vevő nélküli', () => {
    expect(jovahagyandoDatumok(m({ type: 'out', customerId: 'c' }), { vevo: vevo({ paymentTermDays: 15 }), beszerzes: false, ma: MA })).toEqual([
      { cim: 'Kiadás napja', datum: '2026-11-18' },
      { cim: 'Várható fizetés', datum: '2026-12-03', megjegyzes: 'a vevő 15 napos fizetési határideje szerint', lejart: undefined },
    ])
    expect(jovahagyandoDatumok(m({ type: 'out', customerId: 'c', isPaid: true }), { vevo: vevo({}), beszerzes: false, ma: MA })[1]).toEqual({ cim: 'Fizetés', datum: null, megjegyzes: 'fizetve' })
    expect(jovahagyandoDatumok(m({ type: 'out' }), { beszerzes: false, ma: MA })[1]).toMatchObject({ megjegyzes: 'azonnal (vevő nélküli eladás)' })
  })

  it('napok hozzáadása hónap- és évváltáson át', () => {
    expect(napHozzaad('2026-12-30', 3)).toBe('2027-01-02')
  })
})
