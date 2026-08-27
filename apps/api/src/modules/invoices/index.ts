import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
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
    return InvoicesService.list(auth.merchant.id, query)
  }, { query: invoiceQuery })

  .get('/invoices/:id', async ({ auth, params }) => {
    return InvoicesService.get(auth.merchant.id, params.id)
  })

  .get('/orders/:id/invoices', async ({ auth, params }) => {
    return InvoicesService.getByOrder(auth.merchant.id, params.id)
  })

  .use(requirePermission('orders:write'))
  .post('/invoices', async ({ auth, body }) => {
    return InvoicesService.create(auth.merchant.id, body)
  }, { body: invoiceBody })
