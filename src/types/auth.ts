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
  currentPeriodEnd: string | null
  paymentFailedAt: string | null
  cancelledAt: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  /** A raktáros tétlenségi ideje percben (30–720). */
  raktarosTetlensegPerc: number | null
  /** A portál cége, amelyhez ez a Készlet-cég tartozik (a közös keret ez alapján választ). */
  portalCompanyId: string | null
}

/** Négy szerepkör:
 * - 'fo_iroda' (fő iroda) - teljes írási jog a megosztott üzleti adatra
 *   (telephely/termék törzsadat). Ő hagyja jóvá az 'iroda' szerepkör
 *   módosítási kéréseit (pending_changes) és a raktáros beérkezés/
 *   kiszállítás-kéréseit is.
 * - 'iroda' - ugyanazt LÁTJA, amit a fő iroda (teljes, cégen belüli
 *   rálátás), de a telephely/termék törzsadat-módosításai nem azonnal
 *   hatnak, hanem egy pending_changes sorként várnak a fő iroda
 *   jóváhagyására - lásd store/useStore.ts requestChange/
 *   approvePendingChange. Mozgást (be/ki) viszont közvetlenül rögzíthet, és
 *   raktáros-kérést is jóváhagyhat, pont úgy, mint a fő iroda.
 * - 'tulajdonos' - ugyanaz a teljes rálátás, mint a fő irodának, de
 *   KIZÁRÓLAG olvasó jogú - sem közvetlen módosítást, sem jóváhagyási
 *   kérést nem adhat be, semmilyen táblán. Ez adatbázis-szinten (RLS) is
 *   kikényszerítve van, nem csak a felületen.
 * - 'raktaros' - egyetlen hozzárendelt telephelyre korlátozva, lásd
 *   hooks/useAuth.tsx isWarehouseUser.
 * Mindegyik korlátozás a supabase/schema.sql RLS policy-jain keresztül is
 * érvényesül, nem csak a UI-n. */
export type UserRole = 'raktaros' | 'iroda' | 'fo_iroda' | 'tulajdonos'

/** A bejelentkezett felhasználó a KIVÁLASZTOTT cégben: a saját adatai (profiles) és a cégtagsága
 * (company_members: szerepkör, a raktáros telephelye). Egy felhasználó több cégnek is tagja lehet. */
export interface Profile {
  id: string
  companyId: string
  email: string
  /** Null for accounts created before this field existed - the UI falls
   * back to showing the email in those cases (see pages/Settings.tsx for
   * the self-service "set my name" form that closes that gap). */
  name: string | null
  isPlatformAdmin: boolean
  role: UserRole
  /** Only set when role is 'raktaros'. References a row in the (Supabase)
   * locations table - see lib/remoteSync.ts. */
  assignedLocationId: string | null
  assignedLocationName: string | null
  createdAt: string
}

export interface Invite {
  id: string
  companyId: string
  token: string
  /** A meghívott neve - lásd Profile.name. */
  name: string
  role: UserRole
  assignedLocationId: string | null
  assignedLocationName: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
}

export type PendingChangeEntityType = 'location' | 'product'
export type PendingChangeAction = 'create' | 'update' | 'delete' | 'restore'
export type PendingChangeStatus = 'pending' | 'approved' | 'rejected'

/** Egy 'iroda' szerepkör által beadott, fő iroda jóváhagyására váró
 * telephely/termék törzsadat-módosítás - lásd store/useStore.ts
 * requestChange/approvePendingChange és supabase/schema.sql
 * pending_changes tábla. */
export interface PendingChange {
  id: string
  companyId: string
  entityType: PendingChangeEntityType
  /** null, ha 'create' - akkor még nincs valódi entitás-azonosító. */
  entityId: string | null
  action: PendingChangeAction
  /** A tervezett új állapot (create/update esetén a mezők) - delete/restore
   * esetén lehet null, elég az entityId + action. */
  payload: Record<string, unknown> | null
  summary: string
  requestedBy: string | null
  requestedByEmail: string | null
  requestedAt: string
  status: PendingChangeStatus
  reviewedBy: string | null
  reviewedByEmail: string | null
  reviewedAt: string | null
  rejectReason: string | null
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
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    paymentFailedAt: (row.payment_failed_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (row.stripe_subscription_id as string | null) ?? null,
    raktarosTetlensegPerc: typeof row.raktaros_tetlenseg_perc === 'number' ? row.raktaros_tetlenseg_perc : null,
    portalCompanyId: (row.portal_company_id as string | null) ?? null,
  }
}

/** Egy cégtagság: a cég és benne a felhasználó szerepköre. */
export interface CegTagsag {
  company: Company
  role: UserRole
  assignedLocationId: string | null
  assignedLocationName: string | null
}

/** Egy company_members sor (a hozzá tartozó companies sorral együtt, `companies(*)`). */
export function mapTagsagRow(row: Record<string, unknown>): CegTagsag {
  return {
    company: mapCompanyRow(row.companies as Record<string, unknown>),
    role: row.role as UserRole,
    assignedLocationId: (row.assigned_location_id as string | null) ?? null,
    assignedLocationName: (row.assigned_location_name as string | null) ?? null,
  }
}

/** A profiles sor (a felhasználó saját adatai) és a kiválasztott cég tagsága együtt. */
export function mapProfileRow(row: Record<string, unknown>, tagsag: CegTagsag): Profile {
  return {
    id: row.id as string,
    companyId: tagsag.company.id,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    role: tagsag.role,
    assignedLocationId: tagsag.assignedLocationId,
    assignedLocationName: tagsag.assignedLocationName,
    createdAt: row.created_at as string,
  }
}

export function mapInviteRow(row: Record<string, unknown>): Invite {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    token: row.token as string,
    name: row.name as string,
    role: row.role as UserRole,
    assignedLocationId: (row.assigned_location_id as string | null) ?? null,
    assignedLocationName: (row.assigned_location_name as string | null) ?? null,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    usedAt: (row.used_at as string | null) ?? null,
  }
}

export function mapPendingChangeRow(row: Record<string, unknown>): PendingChange {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    entityType: row.entity_type as PendingChangeEntityType,
    entityId: (row.entity_id as string | null) ?? null,
    action: row.action as PendingChangeAction,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    summary: row.summary as string,
    requestedBy: (row.requested_by as string | null) ?? null,
    requestedByEmail: (row.requested_by_email as string | null) ?? null,
    requestedAt: row.requested_at as string,
    status: row.status as PendingChangeStatus,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedByEmail: (row.reviewed_by_email as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    rejectReason: (row.reject_reason as string | null) ?? null,
  }
}
