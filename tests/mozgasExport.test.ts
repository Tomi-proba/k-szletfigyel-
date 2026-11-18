// A Mozgásnapló exportja: minden rögzített sor minden oszlopában van adat (a felhasználó kérése).
import { describe, expect, it } from 'vitest'
import { fifoForrasok, forrasLeiras, mozgasExportSor } from '../src/lib/mozgasExport'
import type { Movement, Product, PurchaseLot } from '../src/types'

const termek = { name: 'Alma', unit: 'kg', salePrice: 500, purchasePrice: 300, defaultVatRatePercent: 27 } as Product
const alap = { id: 'm', productId: 'p', locationId: 'l', date: '2026-11-16', quantity: 10, createdAt: '' }
const k = { product: termek, formatDate: (d: string) => d }

function nincsUres(sor: object) {
  for (const [kulcs, ertek] of Object.entries(sor)) expect(ertek === '' || ertek === undefined || ertek === null, kulcs).toBe(false)
}

describe('Mozgásnapló export', () => {
  it('elfogadott bejövő: a tételből', () => {
    const lot = { quantity: 10, remainingQuantity: 4, unitPrice: 300, shippingCost: 100, currency: 'HUF', exchangeRate: 1, isPaid: false, vatRatePercent: 27 } as PurchaseLot
    const sor = mozgasExportSor({ ...alap, type: 'in' } as Movement, { ...k, lot })
    nincsUres(sor)
    expect(sor).toMatchObject({ egysegar: 300, szallitas: 100, egysegkoltseg: 310, ertek: 3100, maradek: '4 / 10', fizetve: 'Nem fizetett', cikkszam: 'nincs megadva', partner: 'nincs megadva', elabe: 'nem eladás', allapot: 'Érvényes', megjegyzes: 'nincs' })
  })

  it('még el nem fogadott bejövő: a mozgás adataiból', () => {
    const sor = mozgasExportSor({ ...alap, type: 'in', unitPrice: 320, approvalStatus: 'pending' } as Movement, k)
    nincsUres(sor)
    expect(sor).toMatchObject({ egysegar: 320, egysegkoltseg: 320, ertek: 3200, maradek: 'elfogadás után', allapot: 'Jóváhagyásra vár' })
  })

  it('kimenő vevővel, ELÁBÉ-vel', () => {
    const sor = mozgasExportSor({ ...alap, type: 'out', unitCost: 290, saleUnitPrice: 520, customerId: 'c', isPaid: true, saleStatus: 'shipping' } as Movement, { ...k, customer: { name: 'Vevő Kft.' } as never, forras: [{ datum: '2026-11-07', mennyiseg: 10 }] })
    nincsUres(sor)
    expect(sor).toMatchObject({ partner: 'Vevő Kft.', egysegar: 520, ertek: 5200, elabe: 2900, arres: 2300, penznem: 'HUF', arfolyam: 1, szallitas: 0, fizetve: 'Fizetve', eladasStatusz: 'Kiszállítás alatt', afa: '27% (a termék alapértéke)', maradek: '2026-11-07-i beszerzésből 10 kg' })
  })

  it('kimenő vevő nélkül, még nincs önköltség', () => {
    const sor = mozgasExportSor({ ...alap, type: 'out' } as Movement, k)
    nincsUres(sor)
    expect(sor).toMatchObject({ partner: 'vevő nélküli eladás', egysegar: 500, ertek: 5000, elabe: 'elfogadáskor számolódik', fizetve: 'azonnal (vevő nélkül)', eladasStatusz: 'Kiadásra vár' })
  })

  it('leltári hiány: nem eladás, az érték a kiesett áru önköltsége', () => {
    const sor = mozgasExportSor({ ...alap, type: 'out', ok: 'leltar_hiany', unitCost: 300 } as Movement, k)
    nincsUres(sor)
    expect(sor).toMatchObject({ tipus: 'Kimenő (Leltári hiány)', partner: 'nem eladás', egysegar: 'nem eladás', ertek: 3000, elabe: 'nem eladás', fizetve: 'nem eladás' })
  })
})

describe('PDF oszlopszélességek', () => {
  it('a megadott szélességek arányában osztja szét a lapot', async () => {
    const { oszlopSzelessegek } = await import('../src/lib/export')
    const sz = oszlopSzelessegek([10, 30], 100)
    expect(sz[0].cellWidth).toBe(25)
    expect(sz[1].cellWidth).toBe(75)
  })
})

describe('honnan fogyott (FIFO)', () => {
  const lot = (id: string, date: string, quantity: number) => ({ id, productId: 'p', movementId: 'b' + id, date, quantity, remainingQuantity: 0, createdAt: date }) as PurchaseLot
  const ki = (id: string, date: string, quantity: number, unitCost?: number) => ({ ...alap, id, date, quantity, type: 'out', unitCost, createdAt: date }) as Movement
  it('a legrégebbi beszerzésből fogy, a maradék a következőből; az el nem fogadott nem fogy', () => {
    const f = fifoForrasok([ki('k2', '2026-11-10', 30, 1), ki('k1', '2026-11-08', 50, 1), ki('fuggo', '2026-11-09', 99)], [lot('b', '2026-11-05', 40), lot('a', '2026-11-01', 60)])
    expect(f.get('k1')).toEqual([{ datum: '2026-11-01', mennyiseg: 50 }])
    expect(f.get('k2')).toEqual([{ datum: '2026-11-01', mennyiseg: 10 }, { datum: '2026-11-05', mennyiseg: 20 }])
    expect(f.has('fuggo')).toBe(false)
  })
  it('tétel nélküli rész: korábbi készlet; a később érkezett beszerzés nem fogyhat korábban', () => {
    const f = fifoForrasok([ki('k', '2026-11-03', 15, 1)], [lot('a', '2026-11-01', 10), lot('b', '2026-11-05', 40)])
    expect(f.get('k')).toEqual([{ datum: '2026-11-01', mennyiseg: 10 }, { datum: '', mennyiseg: 5 }])
    expect(forrasLeiras(f.get('k')!, 'kg')).toBe('11. 01-i beszerzésből 10 kg; korábbi készletből 5 kg')
  })
})
