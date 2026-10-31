// @vitest-environment jsdom
// A Könyvelő bizonylatából jött jóváhagyandó mozgások jóváhagyása a store-ban (TERV.md F15.4): a
// raktáros egy kattintással a számla szerinti mennyiséggel hagyja jóvá, eltérésnél megjegyzéssel írja át,
// vagy elutasítja („nem érkezett meg / nem ment ki”). A készlet csak a jóváhagyáskor változik.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { DEFAULT_SETTINGS, type Movement } from '../src/types'

const store = () => useStore.getState()

function setup() {
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addProduct({ name: 'Bejárati ajtó', category: 'Ajtó', unit: 'db', currentStock: 0, minStock: 0, purchasePrice: 0, salePrice: 9999, locationId })
  return { productId: store().products[0].id, locationId }
}

/** Úgy teszi a mozgást a store-ba, ahogy az integrációs szolgáltatás hozza létre (és a szerverről betöltődik). */
function konyvelobol(m: Partial<Movement> & Pick<Movement, 'id' | 'productId' | 'locationId' | 'type' | 'quantity'>) {
  useStore.setState((s) => ({
    movements: [
      ...s.movements,
      {
        date: '2026-11-02',
        createdAt: '2026-11-02T08:00:00Z',
        orderedQuantity: m.quantity,
        approvalStatus: 'pending',
        integracioEsemenyId: 'e1',
        integracioDokumentumId: 'd1',
        integracioForras: 'SZSZ-2026-00042',
        ...m,
      },
    ],
  }))
}

const mozgas = (id: string) => store().movements.find((m) => m.id === id)!
const termek = () => store().products[0]

beforeEach(() => localStorage.clear())

describe('a Könyvelőből jött jóváhagyandó mozgások', () => {
  it('beérkezés a számla szerinti mennyiséggel és árral; a készlet csak a jóváhagyáskor nő', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'b1', productId, locationId, type: 'in', quantity: 10, unitPrice: 1000, vatRatePercent: 27 })
    expect(termek().currentStock).toBe(0)
    expect(store().approveIntegrationMovement('b1')).toEqual({ ok: true })
    expect(termek().currentStock).toBe(10)
    expect(mozgas('b1')).toMatchObject({ approvalStatus: 'approved', quantity: 10, orderedQuantity: 10, vatRatePercent: undefined })
    expect(store().lots.at(-1)).toMatchObject({ movementId: 'b1', quantity: 10, unitPrice: 1000, vatRatePercent: 27, vatReclaimable: true })
    expect(store().auditLog.at(-1)!.description).toContain('Könyvelő, SZSZ-2026-00042')
    // Kétszer nem hagyható jóvá.
    expect(store().approveIntegrationMovement('b1')).toEqual({ ok: false, reason: 'not-pending' })
  })

  it('eltérő mennyiség csak megjegyzéssel; a várt mennyiség megmarad', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'b2', productId, locationId, type: 'in', quantity: 10, unitPrice: 1000 })
    expect(store().approveIntegrationMovement('b2', { actualQuantity: 8 })).toEqual({ ok: false, reason: 'note-required' })
    expect(store().approveIntegrationMovement('b2', { actualQuantity: 0, note: 'x' })).toEqual({ ok: false, reason: 'invalid-quantity' })
    expect(store().approveIntegrationMovement('b2', { actualQuantity: 8, note: '2 db sérült' })).toEqual({ ok: true })
    expect(mozgas('b2')).toMatchObject({ quantity: 8, orderedQuantity: 10, discrepancyNote: '2 db sérült' })
    expect(termek().currentStock).toBe(8)
  })

  it('kiadás a vevőszámla árával (nem a termék mostani árával), FIFO-költséggel; készlet nélkül nem megy ki', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'k1', productId, locationId, type: 'out', quantity: 3, saleUnitPrice: 1500, vatRatePercent: 27, customerId: 'v1' })
    expect(store().approveIntegrationMovement('k1')).toEqual({ ok: false, reason: 'insufficient-stock', resultingStock: -3 })
    store().recordMovement({ productId, type: 'in', quantity: 5, date: '2026-11-01', unitPrice: 400 })
    expect(store().approveIntegrationMovement('k1')).toEqual({ ok: true })
    expect(mozgas('k1')).toMatchObject({ approvalStatus: 'approved', quantity: 3, saleUnitPrice: 1500, unitCost: 400, saleStatus: 'pending', isPaid: false })
    expect(termek().currentStock).toBe(2)
  })

  it('szállítói visszaküldés az eredeti beszerzési tételből, ugyanazon az áron; ha abból nincs elég, nem választ másikat', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'b3', productId, locationId, type: 'in', quantity: 4, unitPrice: 1000 })
    store().approveIntegrationMovement('b3')
    store().recordMovement({ productId, type: 'in', quantity: 10, date: '2026-11-03', unitPrice: 500 })
    store().recordMovement({ productId, type: 'out', quantity: 3, date: '2026-11-04' }) // FIFO: a b3 tételből fogy
    konyvelobol({ id: 'v1', productId, locationId, type: 'out', quantity: 2, returnOfMovementId: 'b3' })
    expect(store().approveIntegrationMovement('v1')).toEqual({ ok: false, reason: 'insufficient-lot', available: 1 })
    expect(store().approveIntegrationMovement('v1', { actualQuantity: 1, note: 'csak 1 maradt' })).toEqual({ ok: true })
    expect(mozgas('v1')).toMatchObject({ quantity: 1, unitCost: 1000 })
    expect(store().lots.find((l) => l.movementId === 'b3')!.remainingQuantity).toBe(0)
  })

  it('vevői visszavétel az eladáskori költségen, áfa nélküli tétellel; elutasítás csak indoklással', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'r1', productId, locationId, type: 'in', quantity: 2, unitPrice: 400, vatRatePercent: 27, returnOfMovementId: 'k0' })
    expect(store().approveIntegrationMovement('r1')).toEqual({ ok: true })
    expect(store().lots.at(-1)).toMatchObject({ movementId: 'r1', unitPrice: 400, vatRatePercent: undefined })
    konyvelobol({ id: 'r2', productId, locationId, type: 'in', quantity: 1, unitPrice: 400 })
    expect(store().rejectIntegrationMovement('r2', ' ')).toEqual({ ok: false, reason: 'reason-required' })
    expect(store().rejectIntegrationMovement('r2', 'Nem érkezett meg')).toEqual({ ok: true })
    expect(mozgas('r2')).toMatchObject({ approvalStatus: 'rejected', rejectReason: 'Nem érkezett meg' })
    expect(termek().currentStock).toBe(2)
  })

  it('kézzel rögzített (nem a Könyvelőből jött) mozgáson nem használható', () => {
    const { productId } = setup()
    store().createPendingPurchaseOrder({ productId, quantity: 1, date: '2026-11-02' })
    const id = store().movements.at(-1)!.id
    expect(store().approveIntegrationMovement(id)).toEqual({ ok: false, reason: 'not-integration' })
    expect(store().rejectIntegrationMovement(id, 'x')).toEqual({ ok: false, reason: 'not-integration' })
  })
})
