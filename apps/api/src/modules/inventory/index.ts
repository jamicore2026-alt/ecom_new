import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { InventoryService } from './service'
import { adjustBody, historyQuery, inventoryQuery } from './model'

export const inventoryModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('inventory.read'))
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
  .post('/inventory/:variantId/adjust', async ({ params, body, auth, request }) => {
    const result = await InventoryService.adjust(auth.merchant.id, params.variantId, body)
    auditFromRequest(auth, request, {
      action: 'inventory.adjust',
      entityType: 'product',
      entityId: params.variantId,
      metadata: { change: body.change }
    })
    return result
  }, { body: adjustBody })