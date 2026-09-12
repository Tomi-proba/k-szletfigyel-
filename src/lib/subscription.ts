// Pure subscription-status logic - whether a company's current status means
// the app should be read-only, and how many trial days remain. Kept
// framework/store-independent like the rest of lib/, so it's testable and
// reusable from both the auth gate and the Subscription/Admin pages.
import type { Company } from '../types/auth'

/** How many days after a failed payment the app keeps full access before
 * switching to read-only - gives the company time to fix their card. */
export const PAYMENT_FAILED_GRACE_DAYS = 5

export function isTrialExpired(company: Pick<Company, 'trialEndsAt'>, now: Date = new Date()): boolean {
  return new Date(company.trialEndsAt).getTime() < now.getTime()
}

export function trialDaysRemaining(company: Pick<Company, 'trialEndsAt'>, now: Date = new Date()): number {
  const diffMs = new Date(company.trialEndsAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)))
}

/** True once a company should be locked to view-only (no new recording) -
 * see DOCUMENTATION.md's "Előfizetéses réteg" section for the full state
 * machine (trial -> active -> expired/cancelled, with a payment-failure
 * grace period on top of 'active'). */
export function computeIsReadOnly(company: Company | null, now: Date = new Date()): boolean {
  if (!company) return false
  switch (company.subscriptionStatus) {
    case 'trial':
      return isTrialExpired(company, now)
    case 'active': {
      if (!company.paymentFailedAt) return false
      const graceEndsMs = new Date(company.paymentFailedAt).getTime() + PAYMENT_FAILED_GRACE_DAYS * 24 * 60 * 60 * 1000
      return now.getTime() > graceEndsMs
    }
    case 'expired':
    case 'cancelled':
      return true
  }
}
