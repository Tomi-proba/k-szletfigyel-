// Egy igazság a fizetési kötelezettségekben és a kintlévőségben (TERV.md F19, I6b, KK10): a Könyvelő nyitott
// tételei, és a Készlet saját tételei három csoportban; nincs kitalált határidő; elavulás 24 óra után.
import { describe, expect, it } from 'vitest'
import type { UnpaidSale } from '../src/lib/alerts'
import { egyIgazsag, type KonyveloNyitott } from '../src/lib/egyIgazsag'
import type { PayableObligation } from '../src/lib/payables'
import type { PurchaseLot } from '../src/types'

const ma = new Date().toISOString().slice(0, 10)
const nap = (n: number) => new Date(Date.parse(ma) + n * 86_400_000).toISOString().slice(0, 10)
const cimek = { konyvelo: 'https://konyvelo.example' }

const konyvelo = (over: Partial<KonyveloNyitott> = {}): KonyveloNyitott => ({
  allapot: 'OK',
  asOf: ma,
  kuldve: new Date().toISOString(),
  lekerve: new Date().toISOString(),
  items: [
    { kind: 'PAYABLE', documentId: 'd1', serialNumber: 'SZSZ-1', externalNumber: 'A-1', partnerName: 'Ajtó Kft.', description: null, issueDate: ma, dueDate: nap(-2), open: 127_000_00, link: { module: 'konyvelo', path: '/konyveles/d1?ceg=k' }, stockSources: [{ recordType: 'beszerzes', recordId: 'm1' }] },
    { kind: 'PAYABLE', documentId: 'd2', serialNumber: 'SZSZ-2', externalNumber: null, partnerName: 'Bérbeadó Kft.', description: 'Bérleti díj', issueDate: ma, dueDate: null, open: 50_000_00, link: null, stockSources: [] },
    { kind: 'RECEIVABLE', documentId: 'd3', serialNumber: 'VSZ-1', externalNumber: null, partnerName: 'Vevő Zrt.', description: null, issueDate: ma, dueDate: nap(10), open: 25_400_00, link: null, stockSources: [{ recordType: 'eladas', recordId: 's1' }] },
  ],
  pendingDrafts: [
    { kind: 'PAYABLE', documentId: 'd4', link: null, stockSources: [{ recordType: 'beszerzes', recordId: 'm2' }] },
    { kind: 'RECEIVABLE', documentId: null, link: null, stockSources: [{ recordType: 'eladas', recordId: 's2' }] },
  ],
  ...over,
})

const lot = (id: string, movementId: string): PurchaseLot => ({ id, movementId } as PurchaseLot)
const fiz = (id: string, sourceType: 'purchase' | 'ledger', daysUntilDue: number): PayableObligation => ({
  id,
  sourceType,
  dueDate: nap(daysUntilDue),
  payee: sourceType === 'purchase' ? 'Ajtó Kft.' : 'Bérleti díj',
  description: id,
  amount: 1000,
  daysUntilDue,
  urgency: daysUntilDue < 0 ? 'overdue' : 'upcoming',
  isAlertWorthy: daysUntilDue <= 3,
})
const eladas = (movementId: string): UnpaidSale => ({ movementId, date: ma, customerId: 'c', customerName: 'Vevő Zrt.', productName: 'Ajtó', quantity: 1, unit: 'db', amount: 254_00 })

describe('egy igazság (I6b, KK10)', () => {
  it('Könyvelő nélkül null: a Készlet a saját számítását mutatja', () => {
    expect(egyIgazsag(null, [], [], [], 3)).toBeNull()
    expect(egyIgazsag({ allapot: 'NINCS_KONYVELO' }, [], [], [], 3)).toBeNull()
    expect(egyIgazsag({ allapot: 'NINCS_JOGOSULTSAG' }, [], [], [], 3)).toBeNull()
  })

  it('szállítói oldal: a Könyvelő tétele egyszer szerepel, a könyvelésre váró és a csak a Készletben rögzített külön csoportban', () => {
    const e = egyIgazsag(
      konyvelo(),
      [fiz('l1', 'purchase', -2), fiz('l2', 'purchase', 1), fiz('l3', 'purchase', 1), fiz('n1', 'ledger', 2)],
      [],
      [lot('l1', 'm1'), lot('l2', 'm2'), lot('l3', 'm3')],
      3,
      new Date(),
      cimek,
    )!
    expect(e.fizetendo.map((s) => [s.csoport, s.kulcs])).toEqual([
      ['konyvelo', 'k:PAYABLE:d1:12700000'],
      ['konyvelo', 'k:PAYABLE:d2:5000000'],
      ['konyvelesre_var', 'h:purchase:l2'],
      ['csak_keszlet', 'h:purchase:l3'],
      ['csak_keszlet', 'h:ledger:n1'],
    ])
    const [d1, d2] = e.fizetendo
    expect(d1).toMatchObject({ osszeg: 127_000, hatarido: nap(-2), napHataridoig: -2, riaszt: true, hivatkozas: 'https://konyvelo.example/konyveles/d1?ceg=k', helyi: null })
    // Nincs kitalált határidő: határidő nélkül a csoport végén, a riasztásban nem számít.
    expect(d2).toMatchObject({ hatarido: null, napHataridoig: null, riaszt: false, hivatkozas: null })
    expect(e.fizetendo.filter((s) => s.csoport !== 'konyvelo').every((s) => s.riaszt && s.helyi)).toBe(true)
  })

  it('vevői oldal: ugyanígy; a Készlet-eladásnak nincs kitalált határideje', () => {
    const e = egyIgazsag(konyvelo(), [], [eladas('s1'), eladas('s2'), eladas('s3')], [], 3)!
    expect(e.kintlevoseg.map((s) => [s.csoport, s.kulcs])).toEqual([
      ['konyvelo', 'k:RECEIVABLE:d3:2540000'],
      ['konyvelesre_var', 'h:eladas:s2'],
      ['csak_keszlet', 'h:eladas:s3'],
    ])
    expect(e.kintlevoseg[0]).toMatchObject({ hatarido: nap(10), riaszt: false })
    expect(e.kintlevoseg[2]).toMatchObject({ hatarido: null, riaszt: true })
  })

  it('a lista 24 óránál régebbi: elavult (de látszik); a központ kiesése és a még nem küldött lista is jelezve', () => {
    const regi = new Date(Date.now() - 25 * 3_600_000).toISOString()
    expect(egyIgazsag(konyvelo({ kuldve: regi }), [], [], [], 3)).toMatchObject({ elavult: true, frissitve: regi })
    expect(egyIgazsag(konyvelo(), [], [], [], 3)).toMatchObject({ elavult: false })
    expect(egyIgazsag(konyvelo({ allapot: 'KOZPONT_NEM_ERHETO_EL' }), [], [], [], 3)!.fizetendo).toHaveLength(2)
    const nincs = egyIgazsag({ allapot: 'NINCS_ADAT', items: [], pendingDrafts: [] }, [fiz('l9', 'purchase', 1)], [], [lot('l9', 'm9')], 3)!
    expect(nincs.allapot).toBe('NINCS_ADAT')
    expect(nincs.fizetendo.map((s) => s.csoport)).toEqual(['csak_keszlet'])
  })
})
