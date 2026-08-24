import { Elysia } from 'elysia'
import jwt from '@elysiajs/jwt'
import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, merchants } from '../../database/schema'
import { ACCESS_SECRET } from '../../plugins/auth'
import { unauthorized } from '../../shared/errors'
import { CustomerAuthService, type ShopperContext } from './service'
import {
  loginBody,
  registerBody,
  shopperOrdersQuery,
  storeParams,
  submitReviewBody,
  wishlistBody,
  wishlistParams
} from './model'

export const SHOPPER_TOKEN_TTL = 60 * 60 * 24 * 30 // 30 days

export const shopperJwt = jwt({ name: 'shopperJwt', secret: ACCESS_SECRET })

/** Verifies the shopper bearer token and loads the live customer row.
 *  Scoped derive — only guards routes registered after `.use(shopperGuard)`. */
const shopperGuard = new Elysia({ name: 'shopper-guard' })
  .use(shopperJwt)
  .derive(
    { as: 'scoped' },
    async ({ shopperJwt, headers }): Promise<{ shopper: ShopperContext }> => {
      const token = headers.authorization?.startsWith('Bearer ')
        ? headers.authorization.slice(7)
        : undefined
      if (!token) throw unauthorized()

      const payload = await shopperJwt.verify(token)
      if (!payload || payload.type !== 'shopper' || !payload.sub) {
        throw unauthorized('Invalid or expired session')
      }

      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, String(payload.sub))))
      if (!customer?.passwordHash) throw unauthorized('Account no longer exists')

      const [merchant] = await db
        .select()
        .from(merchants)
        .where(and(eq(merchants.id, customer.merchantId), eq(merchants.status, 'active')))
      if (!merchant) throw unauthorized('Store is not active')

      return { shopper: { customer, merchant } }
    }
  )

export const customerAuthModule = new Elysia({ prefix: '/api/store' })
  .use(shopperJwt)

  .post(
    '/:slug/auth/register',
    async ({ params, body, shopperJwt }) => {
      const result = await CustomerAuthService.register(params.slug, body)
      const token = await shopperJwt.sign({
        sub: result.data.tokenPayload.sub,
        mid: result.data.tokenPayload.mid,
        type: 'shopper',
        exp: `${SHOPPER_TOKEN_TTL}s`
      })
      return {
        success: true,
        data: { token, expiresIn: SHOPPER_TOKEN_TTL, customer: result.data.customer }
      }
    },
    { params: storeParams, body: registerBody, detail: { tags: ['Storefront'], summary: 'Create a shopper account' } }
  )

  .post(
    '/:slug/auth/login',
    async ({ params, body, shopperJwt }) => {
      const result = await CustomerAuthService.login(params.slug, body)
      const token = await shopperJwt.sign({
        sub: result.data.tokenPayload.sub,
        mid: result.data.tokenPayload.mid,
        type: 'shopper',
        exp: `${SHOPPER_TOKEN_TTL}s`
      })
      return {
        success: true,
        data: { token, expiresIn: SHOPPER_TOKEN_TTL, customer: result.data.customer }
      }
    },
    { params: storeParams, body: loginBody, detail: { tags: ['Storefront'], summary: 'Sign in as a shopper' } }
  )

  .use(shopperGuard)
  .get(
    '/:slug/auth/me',
    ({ params, shopper }) => CustomerAuthService.profile(params.slug, shopper),
    { params: storeParams, detail: { tags: ['Storefront'], summary: 'Current shopper profile' } }
  )
  .get(
    '/:slug/auth/orders',
    ({ params, query, shopper }) => CustomerAuthService.ordersList(params.slug, shopper, query),
    {
      params: storeParams,
      query: shopperOrdersQuery,
      detail: { tags: ['Storefront'], summary: 'Shopper order history' }
    }
  )
  .post(
    '/:slug/auth/reviews',
    ({ params, body, shopper }) => CustomerAuthService.submitReview(params.slug, shopper, body),
    {
      params: storeParams,
      body: submitReviewBody,
      detail: { tags: ['Storefront'], summary: 'Create or update a product review (goes to moderation)' }
    }
  )

  .get(
    '/:slug/auth/wishlist',
    ({ params, shopper }) => CustomerAuthService.wishlist(params.slug, shopper),
    { params: storeParams, detail: { tags: ['Storefront'], summary: 'Shopper wishlist' } }
  )
  .post(
    '/:slug/auth/wishlist',
    ({ params, body, shopper }) => CustomerAuthService.addWishlist(params.slug, shopper, body.productId),
    {
      params: storeParams,
      body: wishlistBody,
      detail: { tags: ['Storefront'], summary: 'Save a product to the wishlist (idempotent)' }
    }
  )
  .delete(
    '/:slug/auth/wishlist/:productId',
    ({ params, shopper }) => CustomerAuthService.removeWishlist(params.slug, shopper, params.productId),
    {
      params: wishlistParams,
      detail: { tags: ['Storefront'], summary: 'Remove a product from the wishlist' }
    }
  )
