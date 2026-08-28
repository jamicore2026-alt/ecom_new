import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { outlets } from '../../database/schema'
import type { MerchantContext } from '../../shared/merchant-context'
import { ok } from '../../shared/response'
import { notFound, conflict } from '../../shared/errors'
import type { Outlet } from '../../database/schema'

export interface OutletInput {
  name: string
  code: string
  address?: Outlet['address']
  status?: Outlet['status']
}

export class OutletsService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(outlets)
      .where(eq(outlets.merchantId, merchantId))
      .orderBy(desc(outlets.createdAt))
    return ok(rows)
  }

  static async listAllowed(ctx: MerchantContext) {
    return ok(ctx.allowedOutlets)
  }

  static async get(merchantId: string, outletId: string) {
    const [row] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, outletId), eq(outlets.merchantId, merchantId)))
    if (!row) throw notFound('NOT_FOUND', 'Outlet not found')
    return ok(row)
  }

  static async create(merchantId: string, input: OutletInput) {
    const [existing] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.merchantId, merchantId), eq(outlets.code, input.code)))
    if (existing) throw conflict('OUTLET_CODE_EXISTS', 'An outlet with this code already exists')

    const [row] = await db
      .insert(outlets)
      .values({
        merchantId,
        name: input.name,
        code: input.code,
        address: input.address ?? {},
        status: input.status ?? 'active'
      })
      .returning()
    return ok(row)
  }

  static async update(merchantId: string, outletId: string, input: Partial<OutletInput>) {
    const [existing] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, outletId), eq(outlets.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Outlet not found')

    if (input.code && input.code !== existing.code) {
      const [dup] = await db
        .select()
        .from(outlets)
        .where(and(eq(outlets.merchantId, merchantId), eq(outlets.code, input.code)))
      if (dup) throw conflict('OUTLET_CODE_EXISTS', 'An outlet with this code already exists')
    }

    const [row] = await db
      .update(outlets)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      })
      .where(and(eq(outlets.id, outletId), eq(outlets.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async archive(merchantId: string, outletId: string) {
    const [existing] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, outletId), eq(outlets.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Outlet not found')
    const [row] = await db
      .update(outlets)
      .set({ status: 'archived' })
      .where(and(eq(outlets.id, outletId), eq(outlets.merchantId, merchantId)))
      .returning()
    return ok(row)
  }
}
