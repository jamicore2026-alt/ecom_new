import { Elysia } from 'elysia'
import { authPlugin, hasPermission, isAdmin } from './auth'
import { resolveMerchantContext } from '../shared/merchant-context'
import { forbidden, unauthorized } from '../shared/errors'
import type { ModuleId, Permission } from '../shared/types'

/**
 * Reads the outlet scoped to a request. Priority:
 *   1. `outletId` request param (e.g. /api/outlets/:outletId)
 *   2. `x-outlet-id` header
 * Browser-supplied values are never trusted — resolveMerchantContext validates
 * them against the user's assignments.
 */
export const requestedOutletId = ({
  params,
  headers,
  query
}: {
  params: Record<string, string | undefined>
  headers: Record<string, string | undefined>
  query: Record<string, string | undefined>
}): string | null =>
  params?.outletId ?? headers?.['x-outlet-id'] ?? query?.outletId ?? null

export interface OutletGuardOptions {
  /** Require a resolved outlet scope to be present (OUTLET/OWN-scoped ops). */
  outletRequired?: boolean
  /** Permissions required (checked after module + outlet scope). */
  permissions?: Permission[]
  /** Module(s) that must be enabled for the merchant. */
  module?: ModuleId | ModuleId[]
}

/**
 * Composable authorization guard that enforces (in order):
 *   1. authentication
 *   2. module enabled for the merchant (else 403)
 *   3. outlet scope — if `outletRequired`, a valid in-scope outlet must resolve
 *   4. permission via the existing hasPermission mechanism
 * and attaches `merchantContext` to the request context.
 */
export const outletGuard = (opts: OutletGuardOptions = {}) => {
  // Elysia dedupes plugins by name — multiple outlets that need distinct
  // configs (e.g. a permission-free scope guard plus a permissioned write
  // guard in the same module) must not collide, so we key the name on options.
  const perms = opts.permissions?.join('|') ?? ''
  const mods = (Array.isArray(opts.module) ? opts.module : [opts.module ?? '']).join('|')
  const name = `outlet-guard:${mods}:${perms}:${opts.outletRequired ? 1 : 0}`
  return new Elysia({ name })
    .use(authPlugin)
    .derive({ as: 'scoped' }, async ({ auth, params, headers, query }): Promise<{
      merchantContext: Awaited<ReturnType<typeof resolveMerchantContext>>
    }> => {
      if (!auth) throw unauthorized()

      const context = await resolveMerchantContext(
        auth.user.id,
        auth.merchant.id,
        isAdmin(auth),
        requestedOutletId({ params, headers, query })
      )

      // 1. Module enabled
      if (opts.module) {
        const modules = Array.isArray(opts.module) ? opts.module : [opts.module]
        const missing = modules.find((m) => !context.enabledModules.includes(m))
        if (missing) throw forbidden('This module is not enabled for your store')
      }

      // 2. Outlet scope
      if (opts.outletRequired && !context.selectedOutlet) {
        throw forbidden('No outlet is in scope for this operation')
      }

      // 3. Permission
      if (opts.permissions && opts.permissions.length > 0) {
        if (!hasPermission(auth, ...opts.permissions)) throw forbidden()
      }

      return { merchantContext: context }
    })
}
