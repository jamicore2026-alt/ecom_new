import { eq } from 'drizzle-orm'
import { db } from '../database/client'
import { merchantModules, outlets, userOutlets } from '../database/schema'
import type { Outlet } from '../database/schema'
import type { ModuleId } from './types'

export interface MerchantContext {
  /** Every outlet the current user may act on (owner/admin default to all). */
  allowedOutlets: Outlet[]
  /** The outlet scoped to this request, always validated against allowedOutlets. */
  selectedOutlet: Outlet | null
  /** Enabled modules for the merchant. */
  enabledModules: ModuleId[]
}

/**
 * Resolve the full server-side merchant context for an authenticated user.
 *
 * Rules:
 *  - `allowedOutlets` come ONLY from the `user_outlets` join (or, for
 *    owner/admin with no explicit assignment, all of the merchant's outlets).
 *  - `selectedOutlet` is derived from the request (header/param) but is
 *    ALWAYS validated against `allowedOutlets`. A raw browser-supplied
 *    outletId is never trusted on its own.
 *  - `enabledModules` come from `merchant_modules`.
 *
 * Permission checks continue to go through `hasPermission(auth, ...)` (the
 * existing auth plugin mechanism built on `user.permissions` / role admin);
 * this service owns outlet + module scope only.
 */
export async function resolveMerchantContext(
  userId: string,
  merchantId: string,
  isAdminUser: boolean,
  requestedOutletId?: string | null
): Promise<MerchantContext> {
  const [assignments, modules, merchantOutlets] = await Promise.all([
    db
      .select({ outletId: userOutlets.outletId })
      .from(userOutlets)
      .where(eq(userOutlets.userId, userId)),
    db.select().from(merchantModules).where(eq(merchantModules.merchantId, merchantId)),
    db.select().from(outlets).where(eq(outlets.merchantId, merchantId))
  ])

  // Owners/admins with no explicit assignment implicitly cover every outlet of
  // the merchant. Everyone else is strictly limited to their assigned outlets.
  const allowedOutlets =
    assignments.length > 0
      ? merchantOutlets.filter((o) => assignments.some((a) => a.outletId === o.id))
      : isAdminUser
        ? merchantOutlets
        : []

  const selectedOutlet = requestedOutletId
    ? (allowedOutlets.find((o) => o.id === requestedOutletId) ?? null)
    : allowedOutlets.length === 1
      ? allowedOutlets[0]
      : null

  const enabledModules = modules
    .filter((m) => m.enabled)
    .map((m) => m.module) as ModuleId[]

  return { allowedOutlets, selectedOutlet, enabledModules }
}
