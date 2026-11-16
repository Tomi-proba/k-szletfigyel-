// @vitest-environment jsdom
// F34b: FIFO-nál a termék beszerzési ára csak kézzel változik (az önköltség a beszerzési tételekből jön);
// súlyozott átlagnál a beérkezés átlagolja.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../src/store/useStore'
import { DEFAULT_SETTINGS, type CostingMethod } from '../src/types'

const store = () => useStore.getState()

function setup(costingMethod: CostingMethod) {
  useStore.setState({ dataMode: 'local', remoteRole: null })
  store().clearAllData()
  store().updateSettings({ ...DEFAULT_SETTINGS, costingMethod })
  const locationId = store().locations[0].id
  store().addProduct({ name: 'Alma', category: 'Gyümölcs', unit: 'kg', currentStock: 0, minStock: 0, purchasePrice: 300, salePrice: 500, locationId })
  return store().products[0].id
}
const ar = (id: string) => store().products.find((p) => p.id === id)!.purchasePrice

beforeEach(() => localStorage.clear())

describe('beszerzési ár a terméken', () => {
  it('FIFO: a más áron érkező beszerzés nem írja át (csak a tétel kapja az árat)', () => {
    const id = setup('fifo')
    store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-11-01', unitPrice: 300 })
    store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-11-02', unitPrice: 500 })
    expect(ar(id)).toBe(300)
    expect(store().lots.map((l) => l.unitPrice)).toEqual([300, 500])
    // Kézzel átírható.
    const { id: _id, createdAt: _c, updatedAt: _u, ...termek } = store().products.find((p) => p.id === id)!
    store().updateProduct(id, { ...termek, purchasePrice: 450 })
    expect(ar(id)).toBe(450)
  })

  it('súlyozott átlag: a beérkezés átlagolja', () => {
    const id = setup('average')
    store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-11-01', unitPrice: 300 })
    store().recordMovement({ productId: id, type: 'in', quantity: 10, date: '2026-11-02', unitPrice: 500 })
    expect(ar(id)).toBe(400)
  })
})
