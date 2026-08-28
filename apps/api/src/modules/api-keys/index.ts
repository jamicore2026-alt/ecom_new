import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { ApiKeysService } from './service'

const createBody = t.Object({
  name: t.String({ minLength: 1 }),
  scopes: t.Optional(t.Array(t.String())),
  expiresAt: t.Optional(t.String())
})

const apiKeyQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})

export const apiKeysModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('settings:write'))

  .get('/api-keys', async ({ auth, query }) => ApiKeysService.list(auth.merchant.id, query), { query: apiKeyQuery })
  .post('/api-keys', async ({ auth, body, request }) => {
    const result = await ApiKeysService.create(auth.merchant.id, {
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined
    })
    auditFromRequest(auth, request, {
      action: 'api_key.create',
      entityType: 'api_key',
      entityId: result.data.key.id
    })
    return result
  }, { body: createBody })
  .delete('/api-keys/:id', async ({ auth, params, request }) => {
    const result = await ApiKeysService.revoke(auth.merchant.id, params.id)
    auditFromRequest(auth, request, {
      action: 'api_key.revoke',
      entityType: 'api_key',
      entityId: params.id
    })
    return result
  })
