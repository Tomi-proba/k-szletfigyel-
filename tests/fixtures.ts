// Small builders for test data - only the fields a test cares about need to be given.
import type { LedgerEntry, Movement, Product, PurchaseLot } from '../src/types'

export function lot(overrides: Partial<PurchaseLot> = {}): PurchaseLot {
  return {
    id: 'lot-1',
    productId: 'p1',
    movementId: 'm-in-1',
    date: '2026-10-01',
    quantity: 10,
    remainingQuantity: 10,
    unitPrice: 1000,
    shippingCost: 0,
    currency: 'HUF',
    exchangeRate: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  }
}

export function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'm1',
    productId: 'p1',
    locationId: 'loc1',
    date: '2026-10-05',
    type: 'out',
    quantity: 1,
    createdAt: '2026-10-05T08:00:00.000Z',
    ...overrides,
  }
}

export function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Bejárati ajtó',
    category: 'Ajtó',
    unit: 'db',
    currentStock: 0,
    minStock: 2,
    purchasePrice: 1000,
    salePrice: 2000,
    locationId: 'loc1',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  }
}

export function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'e1',
    date: '2026-10-10',
    type: 'expense',
    category: 'Bérleti díj',
    description: 'Raktárbérlet',
    amount: 100000,
    currency: 'HUF',
    exchangeRate: 1,
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-10T08:00:00.000Z',
    ...overrides,
  }
}
