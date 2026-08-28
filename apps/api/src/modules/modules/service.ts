import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { merchantModules } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
import { MODULES } from '../../shared/types'
import type { ModuleId } from '../../shared/types'

export class ModulesService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(merchantModules)
      .where(eq(merchantModules.merchantId, merchantId))

    // Always return the full known module catalog so the UI can show locked
    // vs available modules. A merchant may not have a row for a module yet.
    const byId = new Map(rows.map((r) => [r.module, r.enabled]))
    const catalog = MODULES.map((module) => ({
      module,
      enabled: byId.get(module) ?? false,
      locked: !byId.has(module)
    }))
    return ok(catalog)
  }

  static async setEnabled(merchantId: string, module: string, enabled: boolean) {
    const mod: ModuleId = module as ModuleId
    if (!MODULES.includes(mod)) {
      throw notFound('MODULE_NOT_FOUND', 'Unknown module')
    }

    const [existing] = await db
      .select()
      .from(merchantModules)
      .where(
        and(eq(merchantModules.merchantId, merchantId), eq(merchantModules.module, mod))
      )

    const [row] = existing
      ? await db
          .update(merchantModules)
          .set({ enabled })
          .where(
            and(eq(merchantModules.merchantId, merchantId), eq(merchantModules.module, mod))
          )
          .returning()
      : await db
          .insert(merchantModules)
          .values({ merchantId, module: mod, enabled })
          .returning()
    return ok(row)
  }
}
