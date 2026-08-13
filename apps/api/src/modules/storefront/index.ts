import { Elysia } from 'elysia'
import { StorefrontService } from './service'
import {
  storefrontQuery,
  storeParams,
  productSlugParams,
  checkoutPreviewBody,
  checkoutBody,
  orderParams
} from './model'

export const storefrontModule = new Elysia({ prefix: '/api/store' })
  .get(
    '/:slug/store',
    ({ params }) => StorefrontService.store(params.slug),
    {
      params: storeParams,
      detail: { tags: ['Storefront'], summary: 'Public store identity' }
    }
  )

  .get(
    '/:slug/categories',
    ({ params }) => StorefrontService.categories(params.slug),
    {
      params: storeParams,
      detail: { tags: ['Storefront'], summary: 'Public category tree' }
    }
  )

  .get(
    '/:slug/products',
    ({ params, query }) => StorefrontService.products(params.slug, query),
    {
      params: storeParams,
      query: storefrontQuery,
      detail: { tags: ['Storefront'], summary: 'Public product list' }
    }
  )

  .get(
    '/:slug/products/:productSlug',
    ({ params }) => StorefrontService.product(params.slug, params.productSlug),
    {
      params: productSlugParams,
      detail: { tags: ['Storefront'], summary: 'Public product detail' }
    }
  )

  .get(
    '/:slug/search',
    ({ params, query }) => StorefrontService.search(params.slug, query),
    {
      params: storeParams,
      query: storefrontQuery,
      detail: { tags: ['Storefront'], summary: 'Public product search' }
    }
  )

  .post(
    '/:slug/checkout/preview',
    ({ params, body }) => StorefrontService.preview(params.slug, body),
    {
      params: storeParams,
      body: checkoutPreviewBody,
      detail: { tags: ['Storefront'], summary: 'Validate cart and compute totals' }
    }
  )

  .post(
    '/:slug/checkout',
    ({ params, body }) => StorefrontService.checkout(params.slug, body),
    {
      params: storeParams,
      body: checkoutBody,
      detail: { tags: ['Storefront'], summary: 'Place an order' }
    }
  )

  .get(
    '/:slug/orders/:orderNumber',
    ({ params }) => StorefrontService.order(params.slug, params.orderNumber),
    {
      params: orderParams,
      detail: { tags: ['Storefront'], summary: 'Public order confirmation' }
    }
  )
