const currencyFormatters = {
  HUF: new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
}

const numberFormatter = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 })

export function formatCurrency(value: number): string {
  return currencyFormatters.HUF.format(value)
}

/** Formats an amount in whichever currency it was recorded in (import
 * batches can be in USD/EUR) - HUF by default. */
export function formatMoney(value: number, currency: keyof typeof currencyFormatters = 'HUF'): string {
  return currencyFormatters[currency].format(value)
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU')
}
