import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { WarehousesService } from './service'

const warehouseBody = t.Object({
  name: t.String({ minLength: 1 }),
  code: t.String({ minLength: 1, maxLength: 30 }),
  address: t.Optional(t.Record(t.String(), t.Any())),
  isDefault: t.Optional(t.Boolean())
})

const warehouseParams = t.Object({ id: t.String() })

const setInventoryBody = t.Object({
  variantId: t.String(),
  quantity: t.Integer({ minimum: 0 })
})

const transferBody = t.Object({
  fromWarehouseId: t.String(),
  toWarehouseId: t.String(),
  variantId: t.String(),
  quantity: t.Integer({ minimum: 1 })
})

export const warehousesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('inventory.read'))

  .get('/warehouses', async ({ auth }) => WarehousesService.list(auth.merchant.id))
  .get('/warehouses/:id', async ({ auth, params }) => WarehousesService.get(auth.merchant.id, params.id), { params: warehouseParams })
  .get('/warehouses/:id/inventory', async ({ auth, params }) => WarehousesService.listInventory(auth.merchant.id, params.id), { params: warehouseParams })
  .get('/transfers', async ({ auth }) => WarehousesService.listTransfers(auth.merchant.id))

  .use(requirePermission('inventory.manage'))
  .put('/warehouses/:id/inventory', async ({ auth, params, body }) => WarehousesService.setInventory(auth.merchant.id, params.id, body.variantId, body.quantity), { params: warehouseParams, body: setInventoryBody })

  .use(requirePermission('inventory:write'))
  .post('/warehouses', async ({ auth, body }) => WarehousesService.create(auth.merchant.id, body), { body: warehouseBody })
  .put('/warehouses/:id', async ({ auth, params, body }) => WarehousesService.update(auth.merchant.id, params.id, body), { params: warehouseParams, body: warehouseBody })
  .post('/transfers', async ({ auth, body }) => WarehousesService.transfer(auth.merchant.id, body), { body: transferBody })
