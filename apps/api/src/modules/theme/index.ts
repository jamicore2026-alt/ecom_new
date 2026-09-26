import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { tenantRateLimiter } from '../../shared/rate-limit'
import { auditFromRequest } from '../audit-logs'
import { ThemeService } from './service'

const themeBody = t.Object({
  primaryColor: t.Optional(t.String({ maxLength: 20 })),
  secondaryColor: t.Optional(t.String({ maxLength: 20 })),
  accentColor: t.Optional(t.String({ maxLength: 20 })),
  logo: t.Optional(t.Nullable(t.String({ maxLength: 1024 }))),
  typography: t.Optional(t.Record(t.String(), t.Any())),
  header: t.Optional(t.Record(t.String(), t.Any())),
  footer: t.Optional(t.Record(t.String(), t.Any())),
  config: t.Optional(t.Record(t.String(), t.Any())),
  note: t.Optional(t.String({ maxLength: 255 }))
})

export const themeModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/theme', async ({ auth }) => ThemeService.get(auth.db, auth.merchant.id))
  .use(requirePermission('settings.manage'))
  // Exact per-tenant budget for theme writes (merchant id known post-auth).
  .use(tenantRateLimiter({ max: 120 }))
  .put('/theme', async ({ auth, body, request }) => {
    const result = await ThemeService.update(auth.db, auth.merchant.id, body, auth.user.id)
    await auditFromRequest(auth, request, {
      action: 'settings.theme.update',
      entityType: 'theme',
      entityId: auth.merchant.id
    })
    return result
  }, { body: themeBody })
  .get('/theme/versions', async ({ auth }) => ThemeService.listVersions(auth.db, auth.merchant.id))
  .post('/theme/rollback/:version', async ({ auth, params, request }) => {
    const result = await ThemeService.rollback(auth.db, auth.merchant.id, Number(params.version), auth.user.id)
    await auditFromRequest(auth, request, {
      action: 'settings.theme.rollback',
      entityType: 'theme',
      entityId: auth.merchant.id,
      metadata: { version: Number(params.version) }
    })
    return result
  })
