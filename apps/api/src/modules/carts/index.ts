import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { CartsService } from './service'

const storeParams = t.Object({ slug: t.String() })

const saveCartBody = t.Object({
  cartId: t.Optional(t.String()),
  customerId: t.Optional(t.String()),
  items: t.Array(
    t.Object({
      variantId: t.String(),
      productId: t.Optional(t.String()),
      name: t.String(),
      price: t.Number(),
      quantity: t.Integer({ minimum: 1 }),
      image: t.Optional(t.Nullable(t.String())),
      slug: t.Optional(t.String())
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
    ({ params, body }) => CartsService.saveCart(params.slug, body),
    {
      params: storeParams,
      body: saveCartBody,
      detail: { tags: ['Storefront'], summary: 'Persist a cart snapshot for abandoned-cart tracking' }
    }
  )
  .get(
    '/store/:slug/cart/recover/:code',
    ({ params }) => CartsService.recoverCart(params.slug, params.code),
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
    ({ auth, query }) => CartsService.list(auth.merchant.id, query),
    {
      query: cartQuery,
      detail: { tags: ['Carts'], summary: 'List carts (abandoned/converted)' }
    }
  )
