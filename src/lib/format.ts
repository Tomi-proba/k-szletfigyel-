const currencyFormatter = new Intl.NumberFormat('hu-HU', {
  style: 'currency',
  currency: 'HUF',
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 })

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU')
}
