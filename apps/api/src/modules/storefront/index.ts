import { Elysia } from 'elysia'
import { StorefrontService } from './service'
import { storefrontQuery, storeParams, productSlugParams } from './model'

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
