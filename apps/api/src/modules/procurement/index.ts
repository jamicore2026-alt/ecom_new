import { Elysia, t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ProcurementService } from './service'

const supplierBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  contactName: t.Optional(t.String({ maxLength: 255 })),
  email: t.Optional(t.String({ maxLength: 255 })),
  phone: t.Optional(t.String({ maxLength: 50 })),
  address: t.Optional(t.Record(t.String(), t.Any())),
  taxId: t.Optional(t.String({ maxLength: 100 })),
  status: t.Optional(t.String({ maxLength: 20 })),
  notes: t.Optional(t.String())
})

const supplierUpdateBody = t.Partial(supplierBody)

const poItemSchema = t.Object({
  variantId: t.String(),
  quantity: t.Integer({ minimum: 1 }),
  unitCost: t.Number({ minimum: 0 })
})

const purchaseOrderBody = t.Object({
  supplierId: t.String(),
  expectedAt: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  items: t.Array(poItemSchema, { minItems: 1 })
})

const purchaseOrderUpdateBody = t.Partial(t.Object({
  supplierId: t.String(),
  expectedAt: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  items: t.Optional(t.Array(poItemSchema, { minItems: 1 }))
}))

const receiveBody = t.Object({
  warehouseId: t.String(),
  notes: t.Optional(t.String()),
  items: t.Array(
    t.Object({
      purchaseOrderItemId: t.String(),
      quantity: t.Integer({ minimum: 1 })
    }),
    { minItems: 1 }
  )
})

const idParam = t.Object({ id: t.String() })

export const procurementModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('inventory.read'))

  .get('/suppliers', async ({ auth, query }) => ProcurementService.listSuppliers(auth.db, auth.merchant.id, query))
  .get('/suppliers/:id', async ({ auth, params }) => ProcurementService.getSupplier(auth.db, auth.merchant.id, params.id), {
    params: idParam
  })
  .get('/purchase-orders', async ({ auth, query }) => ProcurementService.listPurchaseOrders(auth.db, auth.merchant.id, query))
  .get('/purchase-orders/:id', async ({ auth, params }) => ProcurementService.getPurchaseOrder(auth.db, auth.merchant.id, params.id), {
    params: idParam
  })
  .get('/goods-receipts', async ({ auth, query }) => ProcurementService.listGoodsReceipts(auth.db, auth.merchant.id, query))
  .get('/goods-receipts/:id', async ({ auth, params }) => ProcurementService.getGoodsReceipt(auth.db, auth.merchant.id, params.id), {
    params: idParam
  })

  .use(requirePermission('inventory.manage'))

  .post('/suppliers', async ({ auth, body }) => ProcurementService.createSupplier(auth.db, auth.merchant.id, body), {
    body: supplierBody
  })
  .put('/suppliers/:id', async ({ auth, params, body }) => ProcurementService.updateSupplier(auth.db, auth.merchant.id, params.id, body), {
    params: idParam,
    body: supplierUpdateBody
  })

  .post('/purchase-orders', async ({ auth, body }) => ProcurementService.createPurchaseOrder(auth.db, auth.merchant.id, body), {
    body: purchaseOrderBody
  })
  .put('/purchase-orders/:id', async ({ auth, params, body }) => ProcurementService.updatePurchaseOrder(auth.db, auth.merchant.id, params.id, body), {
    params: idParam,
    body: purchaseOrderUpdateBody
  })
  .post('/purchase-orders/:id/submit', async ({ auth, params }) => ProcurementService.transitionPurchaseOrder(auth.db, auth.merchant.id, params.id, 'pending'), {
    params: idParam
  })
  .post('/purchase-orders/:id/approve', async ({ auth, params }) => ProcurementService.transitionPurchaseOrder(auth.db, auth.merchant.id, params.id, 'approved', auth.user.id), {
    params: idParam
  })
  .post('/purchase-orders/:id/cancel', async ({ auth, params }) => ProcurementService.transitionPurchaseOrder(auth.db, auth.merchant.id, params.id, 'cancelled'), {
    params: idParam
  })
  .post('/purchase-orders/:id/receive', async ({ auth, params, body }) =>
    ProcurementService.receiveGoods(auth.db, auth.merchant.id, params.id, auth.user.id, body), {
    params: idParam,
    body: receiveBody
  })