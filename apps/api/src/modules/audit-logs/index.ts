import { Elysia } from 'elysia'
import { t } from 'elysia'
import type { AuthContext, AuthIdentity } from '../../plugins/auth'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { AuditService } from './service'
import { auditQuery } from './model'
import { db as adminDb } from '../../database/client'

export * from './service'

export const auditParams = t.Object({ id: t.String() })

/** Record an audit entry from an authenticated request context. Awaits the insert so it lands before the tenant connection closes; never throws. Resolves `{ persisted }` — false means the write failed LOUDLY (see AuditService.log) while the request kept serving. */
export const auditFromRequest = (
  auth: AuthContext | AuthIdentity,
  request: Request,
  opts: {
    action: string
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  }
): Promise<{ persisted: boolean }> => {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0].trim() || null
  const db = 'db' in auth ? auth.db : adminDb
  return AuditService.log(db, {
    merchantId: auth.merchant.id,
    actorUserId: auth.user.id,
    actorName: auth.user.name,
    ipAddress: ip,
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId,
    metadata: opts.metadata
  })
}

export const auditLogsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('reports.read'))
  .get('/audit', ({ query, auth }) => AuditService.list(auth.db, auth.merchant.id, query), {
    query: auditQuery,
    detail: { tags: ['Audit Logs'], summary: 'List merchant activity / audit history' }
  })
  .get('/audit/:id', ({ params, auth }) => AuditService.detail(auth.db, auth.merchant.id, params.id), {
    params: auditParams,
    detail: { tags: ['Audit Logs'], summary: 'Get a single audit entry' }
  })
  .get('/audit-logs/verify', ({ auth }) => AuditService.verify(auth.db, auth.merchant.id), {
    detail: { tags: ['Audit Logs'], summary: 'Verify the tamper-evidence hash chain' }
  })
  .post('/audit-logs/purge', async ({ auth, body, request, set }) => {
    // Exact per-tenant budget for this destructive route (merchant id known
    // post-auth): max 20 purges/min per store, independent of IP.
    const { getRateLimitStore } = await import('../../shared/rate-limit')
    const tenant = await getRateLimitStore().incrementAndCheck(
      `tenant:${auth.merchant.id}:/api/audit-logs/purge`,
      60_000,
      20
    )
    if (process.env.NODE_ENV !== 'test' && !tenant.allowed) {
      set.status = 429
      return { success: false, error: { code: 'RATE_LIMITED', message: 'Too many purge requests for this store' } }
    }
    const days = typeof body?.olderThanDays === 'number' ? body.olderThanDays : 365
    const result = await AuditService.purge(auth.db, auth.merchant.id, days)
    await AuditService.log(auth.db, {
      merchantId: auth.merchant.id,
      actorUserId: auth.user.id,
      actorName: auth.user.name,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
      action: 'audit.purge',
      entityType: 'audit_log',
      metadata: { olderThanDays: days, deleted: result.deleted }
    })
    return result
  }, {
    body: t.Object({ olderThanDays: t.Optional(t.Number({ minimum: 1, maximum: 3650 })) }),
    detail: { tags: ['Audit Logs'], summary: 'Purge audit rows older than N days (default 365)' }
  })
