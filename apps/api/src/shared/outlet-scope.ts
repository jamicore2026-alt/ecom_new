import { inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { orders } from '../database/schema'
import { isAdmin, type AuthContext } from '../plugins/auth'
import { HttpError } from './errors'
import { resolveMerchantContext, type MerchantContext } from './merchant-context'
import type { DB } from '../database/client'
import type { Scope } from './types'

/**
 * Outlet scope helpers shared by modules whose rows carry an `outletId`
 * (orders currently). Docs: docs/outlet-isolation.md.
 *
 * Semantics:
 *  - Owner/admin users are merchant-wide: `branchIds === null` means "no
 *    outlet restriction at all".
 *  - Everyone else is strictly limited to their assigned outlets
 *    (`merchantContext.allowedOutlets`); an empty set is default-deny.
 *  - Online/ecommerce rows (outletId null) belong to the merchant, not to a
 *    branch, so they stay visible/actionable for branch-staff.
 */

/** 403 OUTLET_SCOPE payload, matching the food-orders module. */
export const outletScopeError = (message: string) => new HttpError(403, 'OUTLET_SCOPE', message)

/**
 * Resolve the caller's effective authorization scope for branch data.
 *
 * Order of precedence (docs/outlet-isolation.md):
 *  - owner/admin (legacy `users.role`) → GLOBAL (merchant-wide, no outlet filter).
 *  - a user with an assigned role row (`users.role_id`) → that role's scope:
 *      GLOBAL/MERCHANT → merchant-wide (same as admin).
 *      OUTLET        → strictly the caller's `user_outlets` assignments.
 *      OWN           → no implicit outlet access (default-deny unless assigned).
 *  - legacy staff with no role row → OUTLET (current behavior: user_outlets
 *    only, empty = default-deny).
 */
export const resolveEffectiveScope = (auth: AuthContext): Scope => {
  if (isAdmin(auth)) return 'GLOBAL'
  return auth.role?.scope ?? 'OUTLET'
}

/**
 * Branch ids the caller may act on, or `null` for merchant-wide callers
 * (GLOBAL/MERCHANT scope). OUTLET/OWN callers are limited to their assigned
 * outlets; an empty set is default-deny.
 */
export const branchScopeIds = (
  context: Pick<MerchantContext, 'allowedOutlets'>,
  isAdminUser: boolean,
  scope: Scope
): string[] | null =>
  isAdminUser || scope === 'GLOBAL' || scope === 'MERCHANT'
    ? null
    : context.allowedOutlets.map((o) => o.id)

/**
 * Resolve the authenticated caller's branch scope. GLOBAL/MERCHANT-scoped
 * callers get `null` (merchant-wide); OUTLET/OWN callers are limited to their
 * assigned outlets.
 */
export const branchScopeOf = async (db: DB, auth: AuthContext): Promise<string[] | null> => {
  const context = await resolveMerchantContext(
    db,
    auth.user.id,
    auth.merchant.id,
    isAdmin(auth),
    null,
    resolveEffectiveScope(auth)
  )
  return branchScopeIds(context, isAdmin(auth), resolveEffectiveScope(auth))
}

/** Row-level guard: a non-ecommerce order must belong to a scoped branch. */
export const assertOrderInBranchScope = (
  branchIds: string[] | null,
  outletId: string | null | undefined
): void => {
  if (branchIds === null) return
  if (outletId !== null && outletId !== undefined && !branchIds.includes(outletId)) {
    throw outletScopeError('This order is outside your outlet scope')
  }
}

/** WHERE fragment for scoped order lists; undefined = merchant-wide caller. */
export const branchOrderCondition = (branchIds: string[] | null): SQL | undefined => {
  if (branchIds === null) return undefined
  const branch = branchIds.length > 0 ? inArray(orders.outletId, branchIds) : sql`false`
  return or(isNull(orders.outletId), branch)
}

/** Shape of the merchant context attached by `outletGuard` (restaurant-era). */
export type OutletScope = { allowedOutlets: Array<{ id: string }> }

/**
 * Outlet ids the caller may touch. For GLOBAL/MERCHANT-scoped callers (and
 * admins) `allowedOutlets` already spans the whole merchant (widened in
 * resolveMerchantContext), so this returns them all; a caller with no outlets
 * returns `null` (default-deny, never a silent "all outlets").
 */
export const effectiveOutletIds = (scope: OutletScope): string[] | null => {
  const ids = scope.allowedOutlets.map((o) => o.id)
  return ids.length > 0 ? ids : null
}

/** 403 guard: an outlet-owned row is only reachable inside the caller's scope. */
export const assertInOutletScope = (
  scope: OutletScope,
  outletId: string | null | undefined
): void => {
  const ids = effectiveOutletIds(scope)
  if (ids === null || !outletId || !ids.includes(outletId)) {
    throw outletScopeError('This record is outside your outlet scope')
  }
}

/**
 * 403 guard for rows that are outlet-owned OR merchant-wide/shared
 * (outletId null). A scoped caller may reach shared rows, but only their own
 * outlet's rows; a caller with no outlets may reach nothing.
 */
export const assertInOutletScopeOrShared = (
  scope: OutletScope,
  outletId: string | null | undefined
): void => {
  const ids = effectiveOutletIds(scope)
  if (ids === null) throw outletScopeError('This record is outside your outlet scope')
  if (outletId != null && !ids.includes(outletId)) {
    throw outletScopeError('This record is outside your outlet scope')
  }
}