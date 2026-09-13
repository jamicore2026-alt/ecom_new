/**
 * P0-4 Merchant Lifecycle State Machine.
 *
 * Canonical states backed by `merchants.status` (varchar(20)). Single source of
 * truth for:
 *  - the allowed status values
 *  - legal state transitions and their business effects
 *  - which statuses may use the operational platform (login / API / refresh)
 *  - which statuses may be served publicly (storefront)
 *
 * Enforcement points (all routed through these helpers so the model cannot be
 * bypassed by a stray string compare):
 *  - login              -> modules/auth/service.ts (validateLogin, session)
 *  - every API request  -> plugins/auth.ts (derive)
 *  - storefront          -> modules/storefront/service.ts (resolveStore)
 *
 * Rule: a merchant that is `active`, `trialing`, or `past_due` keeps operating
 * (a `past_due` merchant is in its grace period). `pending` never gets access,
 * and `suspended` / `cancelled` / `archived` are hard-blocked on every path,
 * including refresh — a token issued before the state change is re-validated
 * against the DB on each request.
 */
export const MERCHANT_STATUSES = [
  'pending',
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'archived'
] as const
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number]

/** Statuses that may operate the platform (login, API, token refresh). */
export const OPERATE_STATUSES: readonly MerchantStatus[] = ['active', 'trialing', 'past_due']

/** Statuses the public storefront may render. */
export const PUBLIC_STATUSES: readonly MerchantStatus[] = ['active']

export interface LifecycleTransition {
  from: MerchantStatus | 'any'
  to: MerchantStatus
  trigger: string
  requiredEffect: string
}

/** Allowed transitions and the business effect the transition must produce. */
export const MERCHANT_LIFECYCLE: LifecycleTransition[] = [
  {
    from: 'pending',
    to: 'trialing',
    trigger: 'onboarding completed',
    requiredEffect: 'provision default resources'
  },
  {
    from: 'trialing',
    to: 'active',
    trigger: 'payment/subscription confirmed',
    requiredEffect: 'enable paid access'
  },
  {
    from: 'trialing',
    to: 'cancelled',
    trigger: 'trial abandoned',
    requiredEffect: 'restrict access and schedule cleanup'
  },
  {
    from: 'active',
    to: 'past_due',
    trigger: 'payment failure',
    requiredEffect: 'grace period and notifications'
  },
  {
    from: 'past_due',
    to: 'active',
    trigger: 'payment recovered',
    requiredEffect: 'restore access'
  },
  {
    from: 'past_due',
    to: 'suspended',
    trigger: 'grace expired',
    requiredEffect: 'block paid capabilities'
  },
  {
    from: 'active',
    to: 'cancelled',
    trigger: 'merchant cancellation',
    requiredEffect: 'stop renewal and preserve retention window'
  },
  {
    from: 'cancelled',
    to: 'archived',
    trigger: 'retention expired',
    requiredEffect: 'disable access and archive data'
  },
  {
    from: 'any',
    to: 'suspended',
    trigger: 'platform abuse/admin action',
    requiredEffect: 'immediate access restriction'
  }
]

export const isMerchantStatus = (value: string): value is MerchantStatus =>
  (MERCHANT_STATUSES as readonly string[]).includes(value)

/** True when the merchant may operate the platform. */
export const isOperational = (status: string): boolean =>
  (OPERATE_STATUSES as readonly string[]).includes(status)

/** True when the public storefront may serve this merchant. */
export const isPubliclyServable = (status: string): boolean =>
  (PUBLIC_STATUSES as readonly string[]).includes(status)

export class IllegalMerchantTransition extends Error {
  constructor(from: string, to: string) {
    super(`Illegal merchant status transition: ${from} -> ${to}`)
    this.name = 'IllegalMerchantTransition'
  }
}

/**
 * Validate a state transition against the lifecycle table. Throws on illegal
 * transitions so status writes go through one auditable chokepoint.
 */
export const assertTransition = (from: string, to: string): LifecycleTransition => {
  // `any` is the wildcard source for admin/abuse suspensions (any -> suspended).
  if (from !== 'any' && !isMerchantStatus(from)) throw new IllegalMerchantTransition(from, to)
  if (!isMerchantStatus(to)) throw new IllegalMerchantTransition(from, to)
  const match = MERCHANT_LIFECYCLE.find(
    (t) => t.to === (to as MerchantStatus) && (t.from === 'any' || t.from === from)
  )
  if (!match) throw new IllegalMerchantTransition(from, to)
  return match
}

/** Legal targets from a given status (for UI/dropdowns and transition tests). */
export const nextStatuses = (from: string): MerchantStatus[] =>
  MERCHANT_LIFECYCLE.filter(
    (t) => t.from === 'any' || t.from === from
  ).map((t) => t.to)