import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { branchScopeOf } from '../../shared/outlet-scope'
import { InvoicesService } from './service'

const invoiceBody = t.Object({
  orderId: t.String(),
  type: t.Optional(t.Union([t.Literal('invoice'), t.Literal('credit_note')])),
  gstin: t.Optional(t.String({ maxLength: 50 }))
})

const invoiceQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})

export const invoicesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/invoices', async ({ auth, query }) => {
    return InvoicesService.list(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), query)
  }, { query: invoiceQuery })

  .get('/invoices/:id', async ({ auth, params }) => {
    return InvoicesService.get(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  })

  .get('/orders/:id/invoices', async ({ auth, params }) => {
    return InvoicesService.getByOrder(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  })

  .use(requirePermission('orders.create', 'orders.update', 'orders.cancel'))
  .post('/invoices', async ({ auth, body }) => {
    return InvoicesService.create(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), body)
  }, { body: invoiceBody })
