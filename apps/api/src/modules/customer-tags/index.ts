import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { CustomerTagsService } from './service'

const tagBody = t.Object({ tag: t.String({ minLength: 1, maxLength: 100 }) })

export const customerTagsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/customers/:id/tags', async ({ auth, params }) =>
    CustomerTagsService.listByCustomer(auth.merchant.id, params.id))

  .use(requirePermission('settings:write'))
  .post('/customers/:id/tags', async ({ auth, params, body }) =>
    CustomerTagsService.add(auth.merchant.id, params.id, body.tag), { body: tagBody })
  .delete('/customers/:id/tags/:tag', async ({ auth, params }) =>
    CustomerTagsService.remove(auth.merchant.id, params.id, params.tag))
