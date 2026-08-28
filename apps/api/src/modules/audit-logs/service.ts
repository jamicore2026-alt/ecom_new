import { desc, gt, lt, and, eq, count } from 'drizzle-orm'
import { db } from '../../database/client'
import { auditLogs } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'

export interface AuditLogInput {
  merchantId: string
  actorUserId?: string | null
  actorName?: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
  ipAddress?: string | null
}

export class AuditService {
  /** Fire-and-forget audit recorder. Never throws, never blocks the caller. */
  static async log(input: AuditLogInput) {
    try {
      await db.insert(auditLogs).values({
        merchantId: input.merchantId,
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName ?? null,
        action: input.action.slice(0, 100),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress ?? null
      })
    } catch (err) {
      console.error('[audit] failed to record action', err)
    }
  }

  static async list(
    merchantId: string,
    q: {
      page?: string
      limit?: string
      action?: string
      entityType?: string
      entityId?: string
      from?: string
      to?: string
    }
  ) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(auditLogs.merchantId, merchantId)]

    if (q.action) conditions.push(eq(auditLogs.action, q.action))
    if (q.entityType) conditions.push(eq(auditLogs.entityType, q.entityType))
    if (q.entityId) conditions.push(eq(auditLogs.entityId, q.entityId))

    const from = q.from ? new Date(q.from) : null
    const to = q.to ? new Date(q.to) : null
    if (from && !Number.isNaN(from.getTime())) conditions.push(gt(auditLogs.createdAt, from))
    if (to && !Number.isNaN(to.getTime())) conditions.push(lt(auditLogs.createdAt, to))

    const where = and(...conditions)

    const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where)
    const rows = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      meta: makeMeta(page, limit, Number(total))
    })
  }

  static async detail(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.merchantId, merchantId), eq(auditLogs.id, id)))
    if (!row) throw notFound('NOT_FOUND', 'Audit entry not found')
    return ok({ ...row, createdAt: row.createdAt.toISOString() })
  }
}
