import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { WarehousesService } from './service'

const warehouseBody = t.Object({
  name: t.String({ minLength: 1 }),
  code: t.String({ minLength: 1, maxLength: 30 }),
  address: t.Optional(t.Record(t.String(), t.Any())),
  isDefault: t.Optional(t.Boolean())
})

const warehouseParams = t.Object({ id: t.String() })
const transferParams = t.Object({ id: t.String() })

const setInventoryBody = t.Object({
  variantId: t.String(),
  quantity: t.Integer({ minimum: 0 })
})

const transferBody = t.Object({
  fromWarehouseId: t.String(),
  toWarehouseId: t.String(),
  variantId: t.String(),
  quantity: t.Integer({ minimum: 1 }),
  deferred: t.Optional(t.Boolean())
})

const bulkTransferBody = t.Object({
  fromWarehouseId: t.String(),
  toWarehouseId: t.String(),
  items: t.Optional(
    t.Array(
      t.Object({
        variantId: t.String(),
        quantity: t.Integer({ minimum: 1 })
      })
    )
  ),
  /** Extra option (PDF-correction): move every product the source holds, each
   *  with its full quantity, plus the unallocated global pool. */
  allStock: t.Optional(t.Boolean())
})

export const warehousesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'inventory' }))
  .use(requirePermission('inventory.read'))

  .get('/warehouses', async ({ auth }) => WarehousesService.list(auth.db, auth.merchant.id))
  .get('/warehouses/:id', async ({ auth, params }) => WarehousesService.get(auth.db, auth.merchant.id, params.id), { params: warehouseParams })
  .get('/warehouses/:id/inventory', async ({ auth, params }) => WarehousesService.listInventory(auth.db, auth.merchant.id, params.id), { params: warehouseParams })
  .get('/transfers', async ({ auth }) => WarehousesService.listTransfers(auth.db, auth.merchant.id))
  .get('/transfers/:id', async ({ auth, params }) => WarehousesService.getTransfer(auth.db, auth.merchant.id, params.id), { params: transferParams })

  .use(requirePermission('inventory.manage'))
  .put('/warehouses/:id/inventory', async ({ auth, params, body }) => WarehousesService.setInventory(auth.db, auth.merchant.id, params.id, body.variantId, body.quantity), { params: warehouseParams, body: setInventoryBody })

  .use(requirePermission('inventory.adjust', 'inventory.manage'))
  .post('/warehouses', async ({ auth, body }) => WarehousesService.create(auth.db, auth.merchant.id, body), { body: warehouseBody })
  .put('/warehouses/:id', async ({ auth, params, body }) => WarehousesService.update(auth.db, auth.merchant.id, params.id, body), { params: warehouseParams, body: warehouseBody })
  .delete('/warehouses/:id', async ({ auth, params }) => WarehousesService.remove(auth.db, auth.merchant.id, params.id), { params: warehouseParams })
  .post('/transfers', async ({ auth, body }) => WarehousesService.transfer(auth.db, auth.merchant.id, body), { body: transferBody })
  .post('/transfers/bulk', async ({ auth, body }) => WarehousesService.transferBulk(auth.db, auth.merchant.id, body), { body: bulkTransferBody })
  .post('/transfers/:id/receive', async ({ auth, params }) => WarehousesService.receiveTransfer(auth.db, auth.merchant.id, params.id), { params: transferParams })
  .post('/transfers/:id/cancel', async ({ auth, params }) => WarehousesService.cancelTransfer(auth.db, auth.merchant.id, params.id), { params: transferParams })
  .post('/transfers/:id/reverse', async ({ auth, params }) =>
    WarehousesService.reverseTransfer(auth.db, auth.merchant.id, params.id, auth.user.role === 'owner' || auth.user.role === 'admin'),
    { params: transferParams })
