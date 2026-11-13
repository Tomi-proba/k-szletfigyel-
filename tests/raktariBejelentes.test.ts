// @vitest-environment jsdom
// Raktári bejelentés → fő irodai elfogadás (2026-11-02, DOCUMENTATION.md 31. fejezet): amit a raktáros
// rögzít, az bejelentés; a készlet csak a fő iroda elfogadásakor változik; a várakozó kiadások lefoglalják
// a készletet; az iroda és a raktáros nem véglegesíthet; a kettős rögzítés gyanúját a program jelzi.
// A szerveres módot hálózat nélkül szimuláljuk (remoteCompanyId üres: nem indul mentés).
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { kettosRogzites, szabadKeszlet } from '../src/lib/raktariBejelentes'
import { DEFAULT_SETTINGS, type Movement } from '../src/types'
import type { UserRole } from '../src/types/auth'

const store = () => useStore.getState()
const mozgas = (id: string) => store().movements.find((m) => m.id === id)!
const termek = () => store().products[0]
const szerep = (remoteRole: UserRole | null) => useStore.setState({ dataMode: remoteRole ? 'remote' : 'local', remoteRole })

function setup(currentStock = 0) {
  szerep(null)
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod: 'fifo' })
  const locationId = store().locations[0].id
  store().addProduct({ name: 'Bejárati ajtó', category: 'Ajtó', unit: 'db', currentStock: 0, minStock: 0, purchasePrice: 500, salePrice: 2000, locationId })
  const productId = store().products[0].id
  if (currentStock > 0) store().recordMovement({ productId, type: 'in', quantity: currentStock, date: '2026-11-01', unitPrice: 500 })
  store().addSupplier({ name: 'Ajtó Kft.', leadTimeDays: 5 })
  const supplierId = store().suppliers.at(-1)!.id
  return { productId, locationId, supplierId }
}

beforeEach(() => localStorage.clear())

describe('raktári bejelentés', () => {
  it('a raktáros nem rögzít közvetlenül; a bejelentés nem változtat készletet', () => {
    const { productId } = setup()
    szerep('raktaros')
    expect(store().recordMovement({ productId, type: 'in', quantity: 5, date: '2026-11-02' })).toEqual({ ok: false, reason: 'forbidden' })
    const r = store().createWarehouseReport({ productId, type: 'in', quantity: 5, date: '2026-11-02', note: 'reggeli szállítás' })
    expect(r.ok).toBe(true)
    const id = (r as { id: string }).id
    expect(mozgas(id)).toMatchObject({ approvalStatus: 'pending', quantity: 5, orderedQuantity: 5, raktarMennyiseg: 5 })
    expect(mozgas(id).raktarVisszaigazolva).toBeTruthy()
    expect(termek().currentStock).toBe(0)
    expect(store().lots).toHaveLength(0)
  })

  it('csak a fő iroda fogadhatja el; elfogadáskor nő a készlet, a megadott áron', () => {
    const { productId, supplierId } = setup()
    szerep('raktaros')
    const id = (store().createWarehouseReport({ productId, type: 'in', quantity: 5, date: '2026-11-02' }) as { id: string }).id
    // A szállítót a raktáros nem adhatja meg (F28).
    expect(store().setMovementSupplier(id, supplierId)).toEqual({ ok: false })
    expect(store().approvePurchaseOrder(id)).toEqual({ ok: false, reason: 'forbidden' })
    szerep('iroda')
    expect(store().approvePurchaseOrder(id)).toEqual({ ok: false, reason: 'forbidden' })
    expect(store().rejectPendingMovement(id, 'nem')).toEqual({ ok: false, reason: 'forbidden' })
    expect(termek().currentStock).toBe(0)
    szerep('fo_iroda')
    // Szállító nélkül (a terméknek sincs) a fő iroda sem fogadhatja el; megadja, és elfogadja.
    expect(store().approvePurchaseOrder(id, undefined, undefined, { unitPrice: 800 })).toEqual({ ok: false, reason: 'supplier-required' })
    expect(store().setMovementSupplier(id, supplierId)).toEqual({ ok: true })
    expect(store().approvePurchaseOrder(id, undefined, undefined, { unitPrice: 800 })).toEqual({ ok: true })
    expect(termek().currentStock).toBe(5)
    expect(mozgas(id)).toMatchObject({ approvalStatus: 'approved', unitPrice: 800, supplierId })
    expect(store().lots.at(-1)).toMatchObject({ movementId: id, quantity: 5, unitPrice: 800 })
  })

  it('a várakozó kiadások lefoglalják a készletet', () => {
    const { productId } = setup(10)
    szerep('raktaros')
    expect(store().createWarehouseReport({ productId, type: 'out', quantity: 7, date: '2026-11-02' }).ok).toBe(true)
    expect(szabadKeszlet(termek(), store().movements)).toBe(3)
    expect(store().createWarehouseReport({ productId, type: 'out', quantity: 5, date: '2026-11-02' })).toEqual({
      ok: false,
      reason: 'insufficient-stock',
      available: 3,
    })
    expect(store().createPendingSalePrep({ productId, quantity: 4, date: '2026-11-02' })).toMatchObject({ ok: false, reason: 'insufficient-stock' })
    // „Megszámoltam”: kifejezett megerősítéssel mehet, a fő iroda dönt.
    expect(store().createWarehouseReport({ productId, type: 'out', quantity: 5, date: '2026-11-02' }, { allowNegativeStock: true }).ok).toBe(true)
    expect(termek().currentStock).toBe(10)
  })

  it('leltári hiány és selejt: megjegyzés kötelező; elfogadáskor nem eladás', () => {
    const { productId } = setup(10)
    szerep('raktaros')
    expect(store().createWarehouseReport({ productId, type: 'out', quantity: 1, date: '2026-11-02', ok: 'selejt' })).toEqual({ ok: false, reason: 'note-required' })
    expect(store().createWarehouseReport({ productId, type: 'in', quantity: 1, date: '2026-11-02', ok: 'selejt', note: 'x' })).toEqual({
      ok: false,
      reason: 'invalid-reason',
    })
    const id = (store().createWarehouseReport({ productId, type: 'out', quantity: 1, date: '2026-11-02', ok: 'selejt', note: 'eltört' }) as { id: string }).id
    szerep('fo_iroda')
    expect(store().approveSalePrep(id, { vatRatePercent: 27, isPaid: true })).toEqual({ ok: true })
    expect(termek().currentStock).toBe(9)
    expect(mozgas(id)).toMatchObject({ approvalStatus: 'approved', ok: 'selejt', saleUnitPrice: undefined, vatRatePercent: undefined, saleStatus: undefined })
  })

  it('elutasítás után a raktáros javítja és újraküldi; a visszaigazolás frissül', () => {
    const { productId } = setup(10)
    szerep('raktaros')
    const id = (store().createWarehouseReport({ productId, type: 'out', quantity: 2, date: '2026-11-02' }) as { id: string }).id
    szerep('fo_iroda')
    expect(store().rejectPendingMovement(id, '')).toEqual({ ok: false, reason: 'reason-required' })
    expect(store().rejectPendingMovement(id, 'Hibás mennyiség')).toEqual({ ok: true })
    expect(mozgas(id)).toMatchObject({ approvalStatus: 'rejected', rejectReason: 'Hibás mennyiség' })
    szerep('raktaros')
    expect(store().resubmitPendingMovement(id, { quantity: 3 })).toEqual({ ok: true })
    expect(mozgas(id)).toMatchObject({ approvalStatus: 'pending', quantity: 3, raktarMennyiseg: 3 })
  })

  it('a raktáros érvényes mozgást nem törölhet és nem vonhat vissza', () => {
    const { productId } = setup(10)
    const eladas = store().recordMovement({ productId, type: 'out', quantity: 1, date: '2026-11-02' })
    expect(eladas.ok).toBe(true)
    const id = store().movements.at(-1)!.id
    szerep('raktaros')
    store().deleteMovement(id, 'soft-delete')
    expect(mozgas(id).deletedAt).toBeUndefined()
    expect(store().cancelSale(id)).toEqual({ ok: false, reason: 'forbidden' })
  })
})

describe('raktári visszaigazolás (irodai rendelés, Könyvelőből jött tétel)', () => {
  function konyvelobol(m: Partial<Movement> & Pick<Movement, 'id' | 'productId' | 'locationId' | 'type' | 'quantity'>) {
    useStore.setState((s) => ({
      movements: [
        ...s.movements,
        { date: '2026-11-02', createdAt: '2026-11-02T08:00:00Z', orderedQuantity: m.quantity, approvalStatus: 'pending', integracioEsemenyId: 'e1', ...m },
      ],
    }))
  }

  it('a raktár visszaigazolja (eltérésnél megjegyzéssel), a készlet csak a fő iroda elfogadásakor nő', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'k1', productId, locationId, type: 'in', quantity: 10, unitPrice: 1000 })
    szerep('raktaros')
    expect(store().approveIntegrationMovement('k1')).toEqual({ ok: false, reason: 'forbidden' })
    expect(store().confirmByWarehouse('k1', { quantity: 8 })).toEqual({ ok: false, reason: 'note-required' })
    expect(store().confirmByWarehouse('k1', { quantity: 8, note: 'Sérült' })).toEqual({ ok: true })
    expect(store().confirmByWarehouse('k1', { quantity: 8, note: 'Sérült' })).toEqual({ ok: false, reason: 'already-confirmed' })
    expect(mozgas('k1')).toMatchObject({ approvalStatus: 'pending', raktarMennyiseg: 8, raktarMegjegyzes: 'Sérült' })
    expect(termek().currentStock).toBe(0)
    szerep('fo_iroda')
    // Alapból a raktár mennyisége és megjegyzése számít.
    expect(store().approveIntegrationMovement('k1')).toEqual({ ok: true })
    expect(termek().currentStock).toBe(8)
    expect(mozgas('k1')).toMatchObject({ approvalStatus: 'approved', quantity: 8, orderedQuantity: 10, discrepancyNote: 'Sérült' })
  })

  it('„nem érkezett meg”: 0-val igazol vissza, a fő iroda utasítja el', () => {
    const { productId, locationId } = setup()
    konyvelobol({ id: 'k2', productId, locationId, type: 'in', quantity: 4 })
    szerep('raktaros')
    expect(store().confirmByWarehouse('k2', { quantity: 0, note: 'Nem jött meg' })).toEqual({ ok: true })
    szerep('fo_iroda')
    expect(store().approveIntegrationMovement('k2')).toEqual({ ok: false, reason: 'invalid-quantity' })
    expect(store().rejectPendingMovement('k2', 'Nem jött meg')).toEqual({ ok: true })
    expect(mozgas('k2').approvalStatus).toBe('rejected')
    expect(termek().currentStock).toBe(0)
  })

  it('irodai rendelés: a raktár visszaigazolja, a fő iroda a raktár mennyiségével fogadja el', () => {
    const { productId, supplierId } = setup()
    szerep('fo_iroda')
    expect(store().createPendingPurchaseOrder({ productId, quantity: 6, date: '2026-11-02', unitPrice: 700, supplierId }).ok).toBe(true)
    expect(store().movements.at(-1)!.supplierId).toBe(supplierId)
    const id = store().movements.at(-1)!.id
    szerep('raktaros')
    expect(store().confirmByWarehouse(id, { quantity: 5, note: 'Hiányzott' })).toEqual({ ok: true })
    szerep('fo_iroda')
    expect(store().approvePurchaseOrder(id)).toEqual({ ok: true })
    expect(termek().currentStock).toBe(5)
    expect(mozgas(id)).toMatchObject({ quantity: 5, orderedQuantity: 6, discrepancyNote: 'Hiányzott' })
  })
})

describe('kettős rögzítés gyanúja', () => {
  it('ugyanaz a termék és irány, legfeljebb egy nap eltéréssel, még el nem fogadva', () => {
    const { productId } = setup(10)
    szerep('raktaros')
    store().createWarehouseReport({ productId, type: 'out', quantity: 2, date: '2026-11-02' })
    const ms = store().movements
    expect(kettosRogzites(ms, { productId, type: 'out', date: '2026-11-03' })).toHaveLength(1)
    expect(kettosRogzites(ms, { productId, type: 'out', date: '2026-11-05' })).toHaveLength(0)
    expect(kettosRogzites(ms, { productId, type: 'in', date: '2026-11-02' })).toHaveLength(0)
    szerep(null)
  })
})
