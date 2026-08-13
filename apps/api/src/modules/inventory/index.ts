import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { InventoryService } from './service'
import { adjustBody, historyQuery, inventoryQuery } from './model'

export const inventoryModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/inventory', async ({ query, auth }) => InventoryService.list(auth.merchant.id, query), {
    query: inventoryQuery
  })
  .get('/inventory/low-stock', async ({ query, auth }) =>
    InventoryService.lowStock(auth.merchant.id, query)
  )
  .get('/inventory/out-of-stock', async ({ query, auth }) =>
    InventoryService.outOfStock(auth.merchant.id, query)
  )
  .get('/inventory/history', async ({ query, auth }) =>
    InventoryService.history(auth.merchant.id, query), { query: historyQuery }
  )
  .use(requirePermission('inventory:write'))
  .post('/inventory/:variantId/adjust', async ({ params, body, auth }) =>
    InventoryService.adjust(auth.merchant.id, params.variantId, body), { body: adjustBody }
  )