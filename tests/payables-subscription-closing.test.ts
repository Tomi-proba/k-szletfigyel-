import { describe, expect, it } from 'vitest'
import { computeUnpaidSales, computeCustomerBalances, computeOpenSales } from '../src/lib/alerts'
import { buildDailyClosingSummary, computeMissingClosings } from '../src/lib/dailyClosing'
import { computePayableObligations } from '../src/lib/payables'
import { PAYMENT_FAILED_GRACE_DAYS, computeIsReadOnly, trialDaysRemaining } from '../src/lib/subscription'
import type { Company } from '../src/types/auth'
import { ledgerEntry, lot, movement, product } from './fixtures'

describe('fizetési kötelezettségek', () => {
  const products = [product({ supplierId: 's1' })]
  const suppliers = [{ id: 's1', name: 'Ablak Kft.', leadTimeDays: 7 }]

  it('a kifizetetlen, határidős beszerzést bruttó összeggel, a lejártat jelölve adja', () => {
    const lots = [lot({ quantity: 1, unitPrice: 1000, vatRatePercent: 27, dueDate: '2026-10-10', isPaid: false })]
    const [o] = computePayableObligations(lots, products, suppliers, [], [7, 3, 1], '2026-10-12')
    expect(o).toMatchObject({ payee: 'Ablak Kft.', amount: 1270, urgency: 'overdue', daysUntilDue: -2, isAlertWorthy: true })
  })

  it('a figyelmeztetési ablakon túli tétel nem riaszt; a kifizetett és a határidő nélküli kimarad', () => {
    const lots = [
      lot({ id: 'tavoli', dueDate: '2026-11-30', isPaid: false }),
      lot({ id: 'fizetve', dueDate: '2026-10-13', isPaid: true }),
      lot({ id: 'nincs-hatarido' }),
    ]
    const result = computePayableObligations(lots, products, suppliers, [], [7, 3, 1], '2026-10-12')
    expect(result.map((o) => o.id)).toEqual(['tavoli'])
    expect(result[0].isAlertWorthy).toBe(false)
  })

  it('a napló kiadásait is hozzáveszi, határidő szerint rendezve', () => {
    const entries = [ledgerEntry({ dueDate: '2026-10-11', isPaid: false })]
    const lots = [lot({ dueDate: '2026-10-20', isPaid: false })]
    const result = computePayableObligations(lots, products, suppliers, entries, [7], '2026-10-12')
    expect(result.map((o) => o.sourceType)).toEqual(['ledger', 'purchase'])
    expect(result[0].payee).toBe('Bérleti díj')
  })
})

describe('vevői kintlévőség és nyitott eladások', () => {
  const customers = [{ id: 'c1', name: 'Kovács Bt.' }]

  it('a kifizetetlen eladásokat a pillanatnyi eladási árral és vevőnként összesíti', () => {
    const movements = [
      movement({ id: 'a', customerId: 'c1', isPaid: false, quantity: 2, saleUnitPrice: 1500 }),
      movement({ id: 'b', customerId: 'c1', isPaid: false, quantity: 1, saleUnitPrice: 1000, cancelled: true }),
      movement({ id: 'c', customerId: 'c1', isPaid: true, quantity: 1, saleUnitPrice: 1000 }),
    ]
    const unpaid = computeUnpaidSales(movements, [product()], customers)
    expect(unpaid).toHaveLength(1)
    expect(unpaid[0]).toMatchObject({ customerName: 'Kovács Bt.', amount: 3000 })
    expect(computeCustomerBalances(unpaid)).toEqual([{ customerId: 'c1', customerName: 'Kovács Bt.', unpaidAmount: 3000, unpaidSalesCount: 1 }])
  })

  it('nyitott az eladás, amíg nincs kiszállítva', () => {
    const movements = [
      movement({ id: 'a', saleStatus: 'pending' }),
      movement({ id: 'b', saleStatus: 'shipping' }),
      movement({ id: 'c', saleStatus: 'delivered' }),
      movement({ id: 'd' }),
    ]
    expect(computeOpenSales(movements, [product()], []).map((s) => s.movementId).sort()).toEqual(['a', 'b'])
  })
})

describe('előfizetés állapota', () => {
  const company = (overrides: Partial<Company>): Company => ({
    id: 'c1',
    name: 'Teszt Kft.',
    createdAt: '2026-10-01T00:00:00Z',
    subscriptionStatus: 'trial',
    trialEndsAt: '2026-10-31T00:00:00Z',
    plan: 'havi_elofizetes',
    planPriceHuf: 2990,
    currentPeriodEnd: null,
    paymentFailedAt: null,
    cancelledAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  })

  it('próbaidő alatt írható, lejárta után csak olvasható', () => {
    expect(computeIsReadOnly(company({}), new Date('2026-10-30T00:00:00Z'))).toBe(false)
    expect(computeIsReadOnly(company({}), new Date('2026-11-01T00:00:00Z'))).toBe(true)
  })

  it('a hátralévő próbanapokat felfelé kerekíti, nem megy 0 alá', () => {
    expect(trialDaysRemaining(company({}), new Date('2026-10-29T12:00:00Z'))).toBe(2)
    expect(trialDaysRemaining(company({}), new Date('2026-12-01T00:00:00Z'))).toBe(0)
  })

  it('sikertelen fizetés után a türelmi idő végéig írható', () => {
    const failedAt = new Date('2026-10-10T00:00:00Z')
    const c = company({ subscriptionStatus: 'active', paymentFailedAt: failedAt.toISOString() })
    const day = 24 * 60 * 60 * 1000
    expect(computeIsReadOnly(c, new Date(failedAt.getTime() + (PAYMENT_FAILED_GRACE_DAYS - 1) * day))).toBe(false)
    expect(computeIsReadOnly(c, new Date(failedAt.getTime() + (PAYMENT_FAILED_GRACE_DAYS + 1) * day))).toBe(true)
  })

  it('lejárt és lemondott előfizetésnél mindig csak olvasható; cég nélkül (helyi mód) írható', () => {
    expect(computeIsReadOnly(company({ subscriptionStatus: 'expired' }))).toBe(true)
    expect(computeIsReadOnly(company({ subscriptionStatus: 'cancelled' }))).toBe(true)
    expect(computeIsReadOnly(null)).toBe(false)
  })
})

describe('napi zárás', () => {
  it('a telephely adott napjának aktív mozgásait termékenként összesíti', () => {
    const movements = [
      movement({ id: 'be', type: 'in', quantity: 5, date: '2026-10-05' }),
      movement({ id: 'ki', type: 'out', quantity: 2, date: '2026-10-05' }),
      movement({ id: 'storno', type: 'out', quantity: 9, date: '2026-10-05', cancelled: true }),
      movement({ id: 'fuggo', type: 'out', quantity: 9, date: '2026-10-05', approvalStatus: 'pending' }),
      movement({ id: 'mas-nap', type: 'out', quantity: 9, date: '2026-10-06' }),
      movement({ id: 'mas-hely', type: 'out', quantity: 9, date: '2026-10-05', locationId: 'loc2' }),
    ]
    const s = buildDailyClosingSummary(movements, [product()], 'loc1', '2026-10-05')
    expect(s.inCount).toBe(1)
    expect(s.outCount).toBe(1)
    expect(s.movementIds.sort()).toEqual(['be', 'ki'])
    expect(s.productBreakdown).toEqual([{ productId: 'p1', productName: 'Bejárati ajtó', unit: 'db', inQuantity: 5, outQuantity: 2 }])
  })

  it('hiányzó zárást csak mozgással érintett, lezáratlan, türelmi időn túli napra jelez', () => {
    const locations = [{ id: 'loc1', name: 'Fő telephely' }]
    const movements = [
      movement({ id: 'a', date: '2026-10-05' }),
      movement({ id: 'b', date: '2026-10-06' }),
      movement({ id: 'c', date: '2026-10-08' }),
    ]
    const closings = [
      {
        id: 'z1',
        locationId: 'loc1',
        date: '2026-10-06',
        status: 'submitted' as const,
        inCount: 0,
        outCount: 1,
        productBreakdown: [],
        movementIds: ['b'],
        submittedAt: '2026-10-06T18:00:00Z',
      },
    ]
    const alerts = computeMissingClosings(locations, movements, closings as never, 1, '2026-10-09')
    expect(alerts.map((a) => a.date)).toEqual(['2026-10-05'])
    expect(alerts[0].daysOverdue).toBe(4)
  })
})
