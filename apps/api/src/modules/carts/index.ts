import { Elysia } from 'elysia'
import { t } from 'elysia'
import { db } from '../../database/client'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { CartsService } from './service'

const storeParams = t.Object({ slug: t.String() })

const saveCartBody = t.Object({
  cartId: t.Optional(t.String()),
  customerId: t.Optional(t.String()),
  email: t.Optional(t.String()),
    items: t.Array(
      t.Object({
        variantId: t.String(),
        productId: t.Optional(t.String()),
        name: t.String(),
        price: t.Number(),
        quantity: t.Integer({ minimum: 1 }),
        image: t.Optional(t.Nullable(t.String())),
        slug: t.Optional(t.String()),
        selections: t.Optional(
          t.Array(
            t.Object({
              optionId: t.String(),
              values: t.Array(t.String())
            })
          )
        )
      })
    )
})

const cartQuery = t.Object({
  status: t.Optional(t.String()),
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})

export const cartsModule = new Elysia({ prefix: '/api' })

  // Public storefront cart persistence (fires from the client-side cart)
  .post(
    '/store/:slug/cart',
    ({ params, body }) => CartsService.saveCart(db, params.slug, body),
    {
      params: storeParams,
      body: saveCartBody,
      detail: { tags: ['Storefront'], summary: 'Persist a cart snapshot for abandoned-cart tracking' }
    }
  )
  .get(
    '/store/:slug/cart/recover/:code',
    ({ params }) => CartsService.recoverCart(db, params.slug, params.code),
    {
      params: t.Object({ slug: t.String(), code: t.String() }),
      detail: { tags: ['Storefront'], summary: 'Recover an abandoned cart via recovery code' }
    }
  )

  // Merchant dashboard — abandoned cart management
  .use(authPlugin)
  .use(requirePermission('customers.read'))
  .get(
    '/carts',
    ({ auth, query }) => CartsService.list(auth.db, auth.merchant.id, query),
    {
      query: cartQuery,
      detail: { tags: ['Carts'], summary: 'List carts (abandoned/converted)' }
    }
  )
  .get(
    '/carts/recovery-report',
    ({ auth }) => CartsService.recoveryReport(auth.db, auth.merchant.id),
    {
      detail: { tags: ['Carts'], summary: 'Recovered-revenue report for abandoned carts' }
    }
  )
  .post(
    '/carts/sweep',
    async ({ auth }) => {
      const touched = await CartsService.sweepAbandonedCarts(auth.db)
      return { success: true as const, data: { touched } }
    },
    {
      detail: { tags: ['Carts'], summary: 'Manually trigger the abandonment sweep (1st + 48h 2nd touch)' }
    }
  )
