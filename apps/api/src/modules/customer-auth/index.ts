import { Elysia, t } from 'elysia'
import jwt from '@elysiajs/jwt'
import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, merchants } from '../../database/schema'
import { ACCESS_SECRET } from '../../plugins/auth'
import { unauthorized } from '../../shared/errors'
import { CustomerAuthService, type ShopperContext } from './service'
import {
  addressBody,
  addressParams,
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  shopperOrdersQuery,
  storeParams,
  submitReviewBody,
  verifyEmailParams,
  wishlistBody,
  wishlistParams
} from './model'

/** Shopper sessions are long-lived but bounded; configurable for deployments. */
export const SHOPPER_TOKEN_TTL = Number(process.env.SHOPPER_TOKEN_TTL ?? 60 * 60 * 24 * 7)

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
      // Password changes bump tokenVersion — pre-change tokens die immediately.
      if (Number(payload.tv ?? 0) !== customer.tokenVersion) {
        throw unauthorized('Session expired — please sign in again')
      }

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
        tv: result.data.tokenPayload.tv,
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
        tv: result.data.tokenPayload.tv,
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
  .post(
    '/:slug/auth/password',
    async ({ params, body, shopperJwt, shopper }) => {
      const result = await CustomerAuthService.changePassword(params.slug, shopper, body)
      // Old tokens are dead (tokenVersion bumped) — hand back a fresh session.
      const token = await shopperJwt.sign({
        sub: result.data.tokenPayload.sub,
        mid: result.data.tokenPayload.mid,
        type: 'shopper',
        tv: result.data.tokenPayload.tv,
        exp: `${SHOPPER_TOKEN_TTL}s`
      })
      return {
        success: true,
        data: { token, expiresIn: SHOPPER_TOKEN_TTL, customer: result.data.customer }
      }
    },
    {
      params: storeParams,
      body: changePasswordBody,
      detail: { tags: ['Storefront'], summary: 'Change password (revokes other sessions)' }
    }
  )

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

  /* ------------------- password reset (public, no auth needed) ------------------ */
  .post(
    '/:slug/auth/forgot-password',
    ({ params, body }) => CustomerAuthService.requestPasswordReset(params.slug, body.email),
    {
      params: storeParams,
      body: forgotPasswordBody,
      detail: { tags: ['Storefront'], summary: 'Request a password reset email' }
    }
  )
  .post(
    '/:slug/auth/reset-password',
    ({ params, body }) => CustomerAuthService.resetPassword(params.slug, body.token, body.password),
    {
      params: storeParams,
      body: resetPasswordBody,
      detail: { tags: ['Storefront'], summary: 'Complete a password reset (single-use token)' }
    }
  )

  /* ---------------------------- email verification ---------------------------- */
  .post(
    '/:slug/auth/resend-verification',
    ({ params, shopper }) =>
      CustomerAuthService.requestEmailVerification(params.slug, shopper),
    {
      params: storeParams,
      detail: { tags: ['Storefront'], summary: 'Resend the email-verification email' }
    }
  )
  .get(
    '/:slug/auth/verify-email/:token',
    ({ params }) => CustomerAuthService.verifyEmail(params.slug, params.token),
    {
      params: verifyEmailParams,
      detail: { tags: ['Storefront'], summary: 'Verify an email address via token' }
    }
  )

  /* ------------------------------ address book ------------------------------ */
  .get(
    '/:slug/auth/addresses',
    ({ params, shopper }) => CustomerAuthService.listAddresses(params.slug, shopper),
    { params: storeParams, detail: { tags: ['Storefront'], summary: 'List shopper addresses' } }
  )
  .post(
    '/:slug/auth/addresses',
    ({ params, body, shopper }) => CustomerAuthService.createAddress(params.slug, shopper, body),
    {
      params: storeParams,
      body: addressBody,
      detail: { tags: ['Storefront'], summary: 'Add a billing/shipping address' }
    }
  )
  .put(
    '/:slug/auth/addresses/:id',
    ({ params, body, shopper }) => CustomerAuthService.updateAddress(params.slug, shopper, params.id, body),
    {
      params: addressParams,
      body: addressBody,
      detail: { tags: ['Storefront'], summary: 'Update an address' }
    }
  )
  .delete(
    '/:slug/auth/addresses/:id',
    ({ params, shopper }) => CustomerAuthService.deleteAddress(params.slug, shopper, params.id),
    {
      params: addressParams,
      detail: { tags: ['Storefront'], summary: 'Delete an address' }
    }
  )
  .post(
    '/:slug/auth/addresses/:id/default/:type',
    ({ params, shopper }) =>
      CustomerAuthService.setDefaultAddress(params.slug, shopper, params.id, params.type as 'shipping' | 'billing'),
    {
      params: t.Object({ slug: t.String(), id: t.String(), type: t.Union([t.Literal('shipping'), t.Literal('billing')]) }),
      detail: { tags: ['Storefront'], summary: 'Set an address as the default shipping or billing address' }
    }
  )
