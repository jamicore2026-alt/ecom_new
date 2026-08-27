import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
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
  .post('/api-keys', async ({ auth, body }) =>
    ApiKeysService.create(auth.merchant.id, {
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined
    }), { body: createBody })
  .delete('/api-keys/:id', async ({ auth, params }) => ApiKeysService.revoke(auth.merchant.id, params.id))
