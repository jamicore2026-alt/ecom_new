import { Elysia } from 'elysia'
import { StorefrontService } from './service'
import { createTenantConnection } from '../../database/tenant-context'
import {
  storefrontQuery,
  storeParams,
  productSlugParams,
  productReviewsQuery,
  checkoutPreviewBody,
  checkoutBody,
  orderParams,
  syncOrderBody,
  trackEventBody
} from './model'

export const storefrontModule = new Elysia({ prefix: '/api/store' })
  .get(
    '/',
    () => StorefrontService.listStores(),
    {
      detail: { tags: ['Storefront'], summary: 'Public store list' }
    }
  )
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
    '/:slug/sitemap',
    ({ params }) => StorefrontService.sitemap(params.slug),
    {
      params: storeParams,
      detail: { tags: ['Storefront'], summary: 'Public sitemap URLs' }
    }
  )

  .post(
    '/:slug/events',
    ({ params, body }) => StorefrontService.trackEvent(params.slug, body),
    {
      params: storeParams,
      body: trackEventBody,
      detail: { tags: ['Storefront'], summary: 'Track a storefront funnel event' }
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
    '/:slug/products/:productSlug/reviews',
    ({ params, query }) => StorefrontService.productReviews(params.slug, params.productSlug, query),
    {
      params: productSlugParams,
      query: productReviewsQuery,
      detail: { tags: ['Storefront'], summary: 'Public approved product reviews' }
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
    async ({ params, body }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.preview(db, params.slug, body)
      } finally {
        await end()
      }
    },
    {
      params: storeParams,
      body: checkoutPreviewBody,
      detail: { tags: ['Storefront'], summary: 'Validate cart and compute totals' }
    }
  )

  .post(
    '/:slug/checkout',
    async ({ params, body }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.checkout(db, params.slug, body)
      } finally {
        await end()
      }
    },
    {
      params: storeParams,
      body: checkoutBody,
      detail: { tags: ['Storefront'], summary: 'Place an order (COD / manual methods)' }
    }
  )

  .post(
    '/:slug/checkout/pay',
    async ({ params, body }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.createProviderCheckout(db, params.slug, body)
      } finally {
        await end()
      }
    },
    {
      params: storeParams,
      body: checkoutBody,
      detail: {
        tags: ['Storefront'],
        summary: 'Create order + provider payment session (redirect URL)'
      }
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

  .post(
    '/:slug/orders/:orderNumber/sync',
    ({ params, body }) => StorefrontService.syncOrder(params.slug, params.orderNumber, body),
    {
      params: orderParams,
      body: syncOrderBody,
      detail: { tags: ['Storefront'], summary: 'Re-verify payment status with the provider' }
    }
  )
