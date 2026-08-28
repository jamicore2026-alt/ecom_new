import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { roles } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound, conflict, badRequest } from '../../shared/errors'

export class RolesService {
  static async list(merchantId: string) {
    const rows = await db.select().from(roles).where(eq(roles.merchantId, merchantId))
    return ok(rows)
  }

  static async get(merchantId: string, roleId: string) {
    const [row] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.merchantId, merchantId)))
    if (!row) throw notFound('NOT_FOUND', 'Role not found')
    return ok(row)
  }

  static async create(merchantId: string, input: { name: string; permissions?: string[]; scope?: string }) {
    await this.assertNameAvailable(merchantId, input.name)
    const [row] = await db
      .insert(roles)
      .values({
        merchantId,
        name: input.name,
        permissions: (input.permissions ?? []) as never,
        scope: (input.scope ?? 'MERCHANT') as never,
        isSystem: false
      })
      .returning()
    return ok(row)
  }

  static async update(
    merchantId: string,
    roleId: string,
    input: { name?: string; permissions?: string[]; scope?: string }
  ) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Role not found')
    if (existing.isSystem) throw badRequest('IMMUTABLE_ROLE', 'System roles cannot be modified')

    if (input.name && input.name !== existing.name) {
      await this.assertNameAvailable(merchantId, input.name, roleId)
    }

    const [row] = await db
      .update(roles)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions as never } : {}),
        ...(input.scope !== undefined ? { scope: input.scope as never } : {})
      })
      .where(and(eq(roles.id, roleId), eq(roles.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async remove(merchantId: string, roleId: string) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Role not found')
    if (existing.isSystem) throw badRequest('IMMUTABLE_ROLE', 'System roles cannot be deleted')
    await db.delete(roles).where(and(eq(roles.id, roleId), eq(roles.merchantId, merchantId)))
    return { success: true, data: { id: roleId } }
  }

  private static async assertNameAvailable(
    merchantId: string,
    name: string,
    excludeId?: string
  ) {
    const rows = await db
      .select()
      .from(roles)
      .where(and(eq(roles.merchantId, merchantId), eq(roles.name, name)))
    if (rows.some((r) => r.id !== excludeId)) {
      throw conflict('ROLE_NAME_EXISTS', 'A role with this name already exists')
    }
  }
}
