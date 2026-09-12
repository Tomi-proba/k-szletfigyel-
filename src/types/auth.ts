// Types for the SaaS réteg (regisztráció, cég, előfizetés) - kept separate
// from types/index.ts since these describe Supabase-backed rows, not the
// existing localStorage business-data model.

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'cancelled'

export interface Company {
  id: string
  name: string
  createdAt: string
  subscriptionStatus: SubscriptionStatus
  trialEndsAt: string
  plan: string
  planPriceHuf: number
  currentPeriodEnd: string | null
  paymentFailedAt: string | null
  cancelledAt: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface Profile {
  id: string
  companyId: string
  email: string
  isPlatformAdmin: boolean
  createdAt: string
}

/** Maps a public.companies row (snake_case, as Supabase returns it) to the
 * camelCase Company shape the app uses everywhere else. */
export function mapCompanyRow(row: Record<string, unknown>): Company {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    subscriptionStatus: row.subscription_status as SubscriptionStatus,
    trialEndsAt: row.trial_ends_at as string,
    plan: row.plan as string,
    planPriceHuf: row.plan_price_huf as number,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    paymentFailedAt: (row.payment_failed_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (row.stripe_subscription_id as string | null) ?? null,
  }
}

export function mapProfileRow(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    email: row.email as string,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    createdAt: row.created_at as string,
  }
}
