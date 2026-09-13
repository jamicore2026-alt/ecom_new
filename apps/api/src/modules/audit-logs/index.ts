import { Elysia } from 'elysia'
import { t } from 'elysia'
import type { AuthContext, AuthIdentity } from '../../plugins/auth'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { AuditService } from './service'
import { auditQuery } from './model'
import { db as adminDb } from '../../database/client'

export * from './service'

export const auditParams = t.Object({ id: t.String() })

/** Record an audit entry from an authenticated request context. Awaits the insert so it lands before the tenant connection closes; never throws. */
export const auditFromRequest = (
  auth: AuthContext | AuthIdentity,
  request: Request,
  opts: {
    action: string
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> => {
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
