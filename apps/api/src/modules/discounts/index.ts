import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { DiscountsService } from './service'
import { couponBody, couponQuery, couponUpdateBody, promotionBody, promotionUpdateBody } from './model'

export const discountsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('settings.manage'))
  .get('/coupons', async ({ query, auth }) => DiscountsService.listCoupons(auth.db, auth.merchant.id, query), {
    query: couponQuery
  })
  .get('/coupons/:id', async ({ params, auth }) => DiscountsService.getCoupon(auth.db, auth.merchant.id, params.id))
  .get('/promotions', async ({ query, auth }) => DiscountsService.listPromotions(auth.db, auth.merchant.id, query))
  .get('/promotions/:id', async ({ params, auth }) =>
    DiscountsService.getPromotion(auth.db, auth.merchant.id, params.id)
  )
  .use(requirePermission('settings.manage'))
  .post('/coupons', async ({ body, auth, request }) => {
    const result = await DiscountsService.createCoupon(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
      action: 'coupon.create',
      entityType: 'coupon',
      entityId: result.data.id
    })
    return result
  }, {
    body: couponBody
  })
  .put('/coupons/:id', async ({ params, body, auth, request }) => {
    const result = await DiscountsService.updateCoupon(auth.db, auth.merchant.id, params.id, body)
    await auditFromRequest(auth, request, {
      action: 'coupon.update',
      entityType: 'coupon',
      entityId: params.id
    })
    return result
  }, { body: couponUpdateBody })
  .delete('/coupons/:id', async ({ params, auth, request }) => {
    const result = await DiscountsService.deleteCoupon(auth.db, auth.merchant.id, params.id)
    await auditFromRequest(auth, request, {
      action: 'coupon.delete',
      entityType: 'coupon',
      entityId: params.id
    })
    return result
  })
  .post('/promotions', async ({ body, auth, request }) => {
    const result = await DiscountsService.createPromotion(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
      action: 'promotion.create',
      entityType: 'promotion',
      entityId: result.data.id
    })
    return result
  }, { body: promotionBody })
  .put('/promotions/:id', async ({ params, body, auth, request }) => {
    const result = await DiscountsService.updatePromotion(auth.db, auth.merchant.id, params.id, body)
    await auditFromRequest(auth, request, {
      action: 'promotion.update',
      entityType: 'promotion',
      entityId: params.id
    })
    return result
  }, { body: promotionUpdateBody })
  .delete('/promotions/:id', async ({ params, auth, request }) => {
    const result = await DiscountsService.deletePromotion(auth.db, auth.merchant.id, params.id)
    await auditFromRequest(auth, request, {
      action: 'promotion.delete',
      entityType: 'promotion',
      entityId: params.id
    })
    return result
  })