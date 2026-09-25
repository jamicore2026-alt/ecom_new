import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, hasPermission, requirePermission } from '../../plugins/auth'
import type { AuthContext } from '../../plugins/auth'
import { branchScopeOf } from '../../shared/outlet-scope'
import { forbidden } from '../../shared/errors'
import { InvoicesService } from './service'

const invoiceBody = t.Object({
  orderId: t.String(),
  type: t.Optional(t.Union([t.Literal('invoice'), t.Literal('credit_note')])),
  gstin: t.Optional(t.String({ maxLength: 50 }))
})

const invoiceQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  /** Invoice-number / order-number / customer-email substring. */
  search: t.Optional(t.String()),
  /** Lifecycle status: draft | issued | paid | void. */
  status: t.Optional(t.String()),
  /** invoice | credit_note. */
  type: t.Optional(t.String())
})

const invoiceParams = t.Object({
  id: t.String()
})

const orderParams = t.Object({
  id: t.String()
})

/** Per-route read guard — module-level `.use(requirePermission(...))` would
 *  stack onto the write routes below, so reads assert inline instead. */
const needInvoiceRead = ({ auth }: { auth: AuthContext }) => {
  if (!hasPermission(auth, 'orders.read')) throw forbidden()
}

export const invoicesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/invoices', async ({ auth, query }) => {
    return InvoicesService.list(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), query)
  }, { query: invoiceQuery, beforeHandle: needInvoiceRead })

  .get('/invoices/:id', async ({ auth, params }) => {
    return InvoicesService.get(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: invoiceParams, beforeHandle: needInvoiceRead })

  .get('/invoices/:id/pdf', async ({ auth, params, set }) => {
    const { buffer, filename } = await InvoicesService.pdf(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
    set.headers['content-type'] = 'application/pdf'
    set.headers['content-disposition'] = `inline; filename="${filename}"`
    return buffer
  }, { params: invoiceParams, beforeHandle: needInvoiceRead })

  .get('/orders/:id/invoices', async ({ auth, params }) => {
    return InvoicesService.getByOrder(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: orderParams, beforeHandle: needInvoiceRead })

  .use(requirePermission('orders.create', 'orders.update', 'orders.cancel'))
  .post('/invoices', async ({ auth, body }) => {
    return InvoicesService.create(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), body)
  }, { body: invoiceBody })

  .post('/invoices/:id/issue', async ({ auth, params }) => {
    return InvoicesService.issue(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: invoiceParams })

  .post('/invoices/:id/pay', async ({ auth, params }) => {
    return InvoicesService.markPaid(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: invoiceParams })

  .post('/invoices/:id/void', async ({ auth, params }) => {
    return InvoicesService.voidInvoice(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: invoiceParams })

  .post('/invoices/:id/send', async ({ auth, params }) => {
    return InvoicesService.send(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: invoiceParams })
