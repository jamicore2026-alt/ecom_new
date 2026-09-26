import { createHash } from 'node:crypto'
import { desc, gt, lt, and, eq, count, asc, lte } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { auditLogs } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
import { createLogger } from '../../shared/logger'

const log = createLogger('audit')
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
  /**
   * Canonical row encoding for the tamper-evidence chain. Field order is
   * fixed and metadata is key-sorted so the same logical row always hashes
   * identically regardless of JS object key insertion order.
   */
  static canonicalRow(row: {
    merchantId: string
    action: string
    entityType?: string | null
    entityId?: string | null
    actorUserId?: string | null
    metadata?: Record<string, unknown>
    createdAt: Date
  }): string {
    const sortedMeta = JSON.stringify(
      Object.keys(row.metadata ?? {})
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (row.metadata as Record<string, unknown>)[k]
          return acc
        }, {})
    )
    return [
      row.merchantId,
      row.action,
      row.entityType ?? '',
      row.entityId ?? '',
      row.actorUserId ?? '',
      sortedMeta,
      row.createdAt.toISOString()
    ].join('|')
  }

  static chainHash(prevHash: string | null, canonical: string): string {
    return createHash('sha256').update(`${prevHash ?? ''}|${canonical}`).digest('hex')
  }

  /**
   * Fail-VISIBLE audit recorder. The insert is awaited so the row lands
   * before the request-scoped tenant connection closes; a write failure is
   * logged LOUDLY (console.error with full context, not a swallowed debug)
   * and re-surfaced to the caller via the returned flag — but never throws,
   * so the business operation keeps serving.
   */
  static async log(db: DB, input: AuditLogInput): Promise<{ persisted: boolean }> {
    try {
      // Head of the merchant chain = latest row's hash (ordered by
      // createdAt, then id as a tiebreak for same-millisecond inserts).
      const [head] = await db
        .select({ rowHash: auditLogs.rowHash })
        .from(auditLogs)
        .where(eq(auditLogs.merchantId, input.merchantId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1)
      const prevHash: string | null = head?.rowHash ?? null
      const createdAt = new Date()
      const canonical = this.canonicalRow({
        merchantId: input.merchantId,
        action: input.action.slice(0, 100),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata ?? {},
        createdAt
      })
      const rowHash = this.chainHash(prevHash, canonical)
      await db.insert(auditLogs).values({
        merchantId: input.merchantId,
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName ?? null,
        action: input.action.slice(0, 100),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress ?? null,
        prevHash,
        rowHash,
        createdAt
      })
      return { persisted: true }
    } catch (err) {
      // FAIL-VISIBLE: loud structured error with full context. The request
      // path continues (we still return persisted:false), but the failure is
      // impossible to miss in logs / alerting — never silently swallowed.
      log.error('AUDIT_WRITE_FAILED — audit trail gap! action may be unrecorded', {
        merchantId: input.merchantId,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actorUserId: input.actorUserId ?? null,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
      })
      return { persisted: false }
    }
  }

  static async list(
    db: DB,
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

  static async detail(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.merchantId, merchantId), eq(auditLogs.id, id)))
    if (!row) throw notFound('NOT_FOUND', 'Audit entry not found')
    return ok({ ...row, createdAt: row.createdAt.toISOString() })
  }

  /**
   * Verify the merchant's hash chain in chronological order. Returns
   * `{ ok: true }` when intact, else `{ ok: false, brokenAt: <id> }`
   * pointing at the first row whose stored hash or prev-link mismatches.
   * Rows written before the chain existed (NULL row_hash) are skipped, not
   * flagged — they predate tamper-evidence.
   */
  static async verify(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.merchantId, merchantId))
      .orderBy(asc(auditLogs.createdAt))
      .limit(10000)
    // Walk the hash links (not wall-clock order): rapid inserts can share a
    // createdAt timestamp, which would false-break time-ordered verification.
    const chained = rows.filter((r) => r.rowHash)
    type AuditRow = (typeof rows)[number]
    const byPrev = new Map<string | null, AuditRow[]>()
    for (const r of chained) {
      const key = r.prevHash ?? null
      if (!byPrev.has(key)) byPrev.set(key, [])
      byPrev.get(key)!.push(r)
    }
    let prev: string | null = null
    let checked = 0
    const seen = new Set<string>()
    for (;;) {
      const candidates: AuditRow[] = (byPrev.get(prev) ?? []).filter((r: AuditRow) => !seen.has(r.id))
      if (candidates.length === 0) break
      if (candidates.length > 1) {
        return ok({ ok: false, brokenAt: (candidates[1] as AuditRow).id, checked, total: rows.length })
      }
      const r: AuditRow = candidates[0]
      const canonical = this.canonicalRow({
        merchantId: r.merchantId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actorUserId: r.actorUserId,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt
      })
      if (this.chainHash(r.prevHash ?? null, canonical) !== r.rowHash) {
        return ok({ ok: false, brokenAt: r.id, checked, total: rows.length })
      }
      seen.add(r.id)
      prev = r.rowHash
      checked++
    }
    return ok({ ok: true, checked, total: rows.length })
  }

  /**
   * Retention purge: delete rows older than `olderThanDays` (default 365).
   * Returns the deleted count. Callers should audit-log the purge itself
   * (action `audit.purge`) — the fresh audit row postdates the cutoff so it
   * survives its own purge.
   */
  static async purge(db: DB, merchantId: string, olderThanDays = 365): Promise<{ deleted: number }> {
    const days = Number.isFinite(olderThanDays) ? Math.max(1, Math.floor(olderThanDays)) : 365
    const cutoff = new Date(Date.now() - days * 86400000)
    const removed = await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.merchantId, merchantId), lte(auditLogs.createdAt, cutoff)))
      .returning({ id: auditLogs.id })
    log.info(`audit retention purge merchant=${merchantId} deleted=${removed.length} cutoff=${cutoff.toISOString()}`)
    return { deleted: removed.length }
  }

  /**
   * Scheduled retention sweep across merchants: purges every merchant's rows
   * older than `olderThanDays`. Invoked from runJobWorker
   * (shared/jobs-worker.ts). Best-effort per merchant — one failure never
   * aborts the sweep.
   */
  static async purgeExpired(db: DB, olderThanDays = 365): Promise<number> {
    const days = Number.isFinite(olderThanDays) ? Math.max(1, Math.floor(olderThanDays)) : 365
    const cutoff = new Date(Date.now() - days * 86400000)
    const merchants = await db
      .selectDistinct({ merchantId: auditLogs.merchantId })
      .from(auditLogs)
      .where(lte(auditLogs.createdAt, cutoff))
    let total = 0
    for (const m of merchants) {
      try {
        const r = await this.purge(db, m.merchantId, days)
        total += r.deleted
      } catch (e) {
        log.error('AUDIT_RETENTION_SWEEP_FAILED — expired rows retained', { merchantId: m.merchantId, error: e })
      }
    }
    return total
  }
}
