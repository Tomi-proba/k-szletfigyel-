import { describe, expect, it } from 'vitest'
import { computeCategoryTotals, computeDueRecurringOccurrences, computeFinancialSummary, computeVatSummary, ledgerEntryHuf } from '../src/lib/ledger'
import { computeAutoVatTotals, computeCombinedVatSummary, listAutoVatRows, movementVatAmountHuf } from '../src/lib/vat'
import { ledgerEntry, lot, movement, product } from './fixtures'

const OKT = ['2026-10-01', '2026-10-31'] as const

describe('automatikus áfa', () => {
  it('eladás áfája: mennyiség × eladási ár × kulcs; ár vagy kulcs nélkül 0', () => {
    expect(movementVatAmountHuf({ quantity: 2, saleUnitPrice: 1000, vatRatePercent: 27 })).toBe(540)
    expect(movementVatAmountHuf({ quantity: 2, saleUnitPrice: 1000 })).toBe(0)
    expect(movementVatAmountHuf({ quantity: 2, vatRatePercent: 27 })).toBe(0)
  })

  it('a beszerzés áfáját visszaigényelhetőség szerint, az eladásét befizetendőként összesíti', () => {
    const lots = [
      lot({ id: 'a', quantity: 1, unitPrice: 1000, vatRatePercent: 27 }),
      lot({ id: 'b', quantity: 1, unitPrice: 1000, vatRatePercent: 27, vatReclaimable: false }),
      lot({ id: 'nincs-afa', quantity: 1, unitPrice: 1000 }),
    ]
    const movements = [movement({ quantity: 1, saleUnitPrice: 2000, vatRatePercent: 27 })]
    expect(computeAutoVatTotals(lots, movements, ...OKT)).toEqual({ purchaseReclaimable: 270, purchaseNonReclaimable: 270, sale: 540 })
  })

  it('a stornózott, törölt, jóváhagyásra váró és elutasított eladás nem számít bele az egyenlegbe', () => {
    const base = { quantity: 1, saleUnitPrice: 1000, vatRatePercent: 27 }
    const movements = [
      movement({ id: 's', ...base, cancelled: true }),
      movement({ id: 't', ...base, deletedAt: '2026-10-06T00:00:00Z' }),
      movement({ id: 'f', ...base, approvalStatus: 'pending' }),
      movement({ id: 'e', ...base, approvalStatus: 'rejected' }),
      movement({ id: 'ok', ...base, approvalStatus: 'approved' }),
    ]
    expect(computeAutoVatTotals([], movements, ...OKT).sale).toBe(270)
  })

  it('a stornózott eladás a listában látható marad, jelölve', () => {
    const rows = listAutoVatRows(
      [],
      [movement({ quantity: 1, saleUnitPrice: 1000, vatRatePercent: 27, cancelled: true })],
      [product()],
      [],
      ...OKT,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sourceType: 'sale', cancelled: true, amountHuf: 270, description: 'Bejárati ajtó' })
  })

  it('a kézi és az automatikus áfát egy egyenlegbe vonja, a nem visszaigényelhetőt kihagyja', () => {
    const entries = [
      ledgerEntry({ id: 'k1', category: 'ÁFA', amount: 1000, vatDirection: 'payable' }),
      ledgerEntry({ id: 'k2', category: 'ÁFA', amount: 300, vatDirection: 'reclaimable' }),
    ]
    const lots = [
      lot({ id: 'a', quantity: 1, unitPrice: 1000, vatRatePercent: 27 }),
      lot({ id: 'b', quantity: 1, unitPrice: 1000, vatRatePercent: 27, vatReclaimable: false }),
    ]
    const movements = [movement({ quantity: 1, saleUnitPrice: 2000, vatRatePercent: 27 })]
    const s = computeCombinedVatSummary(entries, lots, movements, ...OKT)
    expect(s.totalPayable).toBe(1540)
    expect(s.totalReclaimable).toBe(570)
    expect(s.netBalance).toBe(970)
    expect(s.autoPurchaseNonReclaimable).toBe(270)
  })
})

describe('pénzügyi napló', () => {
  it('a devizás tételt forintra számolja', () => {
    expect(ledgerEntryHuf({ amount: 10, exchangeRate: 400 })).toBe(4000)
  })

  it('a kézi áfa-összesítő csak az ÁFA kategóriát és az időszak nem törölt tételeit nézi', () => {
    const entries = [
      ledgerEntry({ id: 'a', category: 'ÁFA', amount: 500, vatDirection: 'payable' }),
      ledgerEntry({ id: 'b', category: 'ÁFA', amount: 500, vatDirection: 'payable', deletedAt: '2026-10-11T00:00:00Z' }),
      ledgerEntry({ id: 'c', category: 'ÁFA', amount: 500, vatDirection: 'payable', date: '2026-11-02' }),
      ledgerEntry({ id: 'd', category: 'Bérleti díj', amount: 999 }),
    ]
    expect(computeVatSummary(entries, ...OKT)).toEqual({ totalPayable: 500, totalReclaimable: 0, netBalance: 500 })
  })

  it('kategóriánként összesít, magyar ábécérendben', () => {
    const entries = [
      ledgerEntry({ id: 'a', category: 'Osztalék', type: 'expense', amount: 10 }),
      ledgerEntry({ id: 'b', category: 'Bérköltség', type: 'expense', amount: 20 }),
      ledgerEntry({ id: 'c', category: 'Bérköltség', type: 'income', amount: 5 }),
    ]
    expect(computeCategoryTotals(entries, ...OKT)).toEqual([
      { category: 'Bérköltség', income: 5, expense: 20 },
      { category: 'Osztalék', income: 0, expense: 10 },
    ])
  })

  it('az eredménykimutatás a naplót, a készletforgalmat és az automatikus áfát együtt adja', () => {
    const entries = [ledgerEntry({ type: 'expense', amount: 100 }), ledgerEntry({ id: 'i', type: 'income', category: 'Egyéb', amount: 50 })]
    const s = computeFinancialSummary(entries, 1000, 600, 30, 70, ...OKT)
    expect(s.totalIncome).toBe(50 + 1000 + 30)
    expect(s.totalExpense).toBe(100 + 600 + 70)
    expect(s.netResult).toBe(310)
  })

  it('az ismétlődő tétel a rövidebb hónapban a hónap utolsó napjára kerül, a folyó hónapban csak az esedékesség után', () => {
    const r = { dayOfMonth: 31, startDate: '2026-01-01' }
    expect(computeDueRecurringOccurrences(r, '2026-03-05')).toEqual([
      { month: '2026-01', date: '2026-01-31' },
      { month: '2026-02', date: '2026-02-28' },
    ])
    expect(computeDueRecurringOccurrences({ ...r, lastGeneratedMonth: '2026-02' }, '2026-03-31')).toEqual([
      { month: '2026-03', date: '2026-03-31' },
    ])
    expect(computeDueRecurringOccurrences({ ...r, endDate: '2026-01-31' }, '2026-03-31')).toHaveLength(1)
  })
})
