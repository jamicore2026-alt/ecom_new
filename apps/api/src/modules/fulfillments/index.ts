import { Elysia, t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { branchScopeOf } from '../../shared/outlet-scope'
import { FulfillmentsService } from './service'
import {
  createFulfillmentBody,
  fulfillmentParams,
  fulfillmentQuery,
  markShippedBody,
  updateFulfillmentBody
} from './model'

const slipQuery = t.Object({
  format: t.Optional(t.Union([t.Literal('json'), t.Literal('html')]))
})

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** Minimal print-friendly HTML rendering of a packing slip (print via browser). */
function renderPackingSlipHtml(slip: {
  fulfillment: { id: string; status: string; carrier: string | null; trackingNumber: string | null }
  order: { orderNumber: string; customerEmail: string | null; shippingAddress: Record<string, unknown> | object | null }
  items: Array<{ name: string; sku: string | null; quantity: number }>
  totalQuantity: number
}): string {
  const addr = (slip.order.shippingAddress ?? {}) as Record<string, unknown>
  const addrLines = [addr.name, addr.line1, addr.line2, [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '), addr.country, addr.phone]
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join('')
  const rows = slip.items
    .map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.sku ?? '—')}</td><td style="text-align:right">${i.quantity}</td></tr>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slip ${esc(slip.order.orderNumber)}</title>` +
    `<style>body{font-family:sans-serif;max-width:640px;margin:32px auto;padding:0 16px;color:#111}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}@media print{body{margin:0}}</style></head><body>` +
    `<h1>Packing slip</h1><p>Order <strong>${esc(slip.order.orderNumber)}</strong> · Fulfillment ${esc(slip.fulfillment.id.slice(0, 8))} · ${esc(slip.fulfillment.status)}</p>` +
    (slip.fulfillment.carrier ? `<p>Carrier: ${esc(slip.fulfillment.carrier)}${slip.fulfillment.trackingNumber ? ` · Tracking: ${esc(slip.fulfillment.trackingNumber)}` : ''}</p>` : '') +
    (slip.order.customerEmail ? `<p>Customer: ${esc(slip.order.customerEmail)}</p>` : '') +
    `<h2>Ship to</h2>${addrLines || '<p>—</p>'}` +
    `<h2>Items (${slip.totalQuantity})</h2><table><thead><tr><th>Item</th><th>SKU</th><th style="text-align:right">Qty</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<script>window.print&&new URLSearchParams(location.search).get('print')==='1'&&window.print()</script></body></html>`
}

export const fulfillmentsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('orders.read'))

  .get('/fulfillments', async ({ auth, query }) => {
    return FulfillmentsService.list(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), query)
  }, { query: fulfillmentQuery })

  .get('/fulfillments/:id', async ({ auth, params }) => {
    return FulfillmentsService.get(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: fulfillmentParams })

  .get('/fulfillments/:id/slip', async ({ auth, params, query, set }) => {
    const slip = await FulfillmentsService.slip(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
    if (query.format === 'html') {
      set.headers['content-type'] = 'text/html; charset=utf-8'
      return renderPackingSlipHtml(slip.data)
    }
    return slip
  }, { params: fulfillmentParams, query: slipQuery })

  .use(requirePermission('orders.create', 'orders.update', 'orders.cancel'))
  .post('/fulfillments', async ({ auth, body }) => {
    return FulfillmentsService.create(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), body)
  }, { body: createFulfillmentBody })

  .put('/fulfillments/:id', async ({ auth, params, body }) => {
    return FulfillmentsService.update(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id, body)
  }, { params: fulfillmentParams, body: updateFulfillmentBody })

  .post('/fulfillments/:id/ship', async ({ auth, params, body }) => {
    return FulfillmentsService.markShipped(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id, body)
  }, { params: fulfillmentParams, body: markShippedBody })

  .post('/fulfillments/:id/cancel', async ({ auth, params }) => {
    return FulfillmentsService.cancel(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: fulfillmentParams })
