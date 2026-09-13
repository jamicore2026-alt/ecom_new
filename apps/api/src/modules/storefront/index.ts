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
    async ({ params }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.categories(db, params.slug)
      } finally {
        await end()
      }
    },
    {
      params: storeParams,
      detail: { tags: ['Storefront'], summary: 'Public category tree' }
    }
  )

  .get(
    '/:slug/sitemap',
    async ({ params }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.sitemap(db, params.slug)
      } finally {
        await end()
      }
    },
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
    async ({ params, query }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.products(db, params.slug, query)
      } finally {
        await end()
      }
    },
    {
      params: storeParams,
      query: storefrontQuery,
      detail: { tags: ['Storefront'], summary: 'Public product list' }
    }
  )

  .get(
    '/:slug/products/:productSlug',
    async ({ params }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.product(db, params.slug, params.productSlug)
      } finally {
        await end()
      }
    },
    {
      params: productSlugParams,
      detail: { tags: ['Storefront'], summary: 'Public product detail' }
    }
  )

  .get(
    '/:slug/products/:productSlug/reviews',
    async ({ params, query }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.productReviews(db, params.slug, params.productSlug, query)
      } finally {
        await end()
      }
    },
    {
      params: productSlugParams,
      query: productReviewsQuery,
      detail: { tags: ['Storefront'], summary: 'Public approved product reviews' }
    }
  )

  .get(
    '/:slug/search',
    async ({ params, query }) => {
      const merchantId = await StorefrontService.resolveMerchantId(params.slug)
      const { db, end } = await createTenantConnection(merchantId)
      try {
        return await StorefrontService.search(db, params.slug, query)
      } finally {
        await end()
      }
    },
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
