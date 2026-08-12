import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { DiscountsService } from './service'
import { couponBody, couponQuery, couponUpdateBody, promotionBody, promotionUpdateBody } from './model'

export const discountsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/coupons', async ({ query, auth }) => DiscountsService.listCoupons(auth.merchant.id, query), {
    query: couponQuery
  })
  .get('/coupons/:id', async ({ params, auth }) => DiscountsService.getCoupon(auth.merchant.id, params.id))
  .get('/promotions', async ({ query, auth }) => DiscountsService.listPromotions(auth.merchant.id, query))
  .get('/promotions/:id', async ({ params, auth }) =>
    DiscountsService.getPromotion(auth.merchant.id, params.id)
  )
  .use(requirePermission('discounts:write'))
  .post('/coupons', async ({ body, auth }) => DiscountsService.createCoupon(auth.merchant.id, body), {
    body: couponBody
  })
  .put('/coupons/:id', async ({ params, body, auth }) =>
    DiscountsService.updateCoupon(auth.merchant.id, params.id, body), { body: couponUpdateBody }
  )
  .delete('/coupons/:id', async ({ params, auth }) =>
    DiscountsService.deleteCoupon(auth.merchant.id, params.id)
  )
  .post('/promotions', async ({ body, auth }) =>
    DiscountsService.createPromotion(auth.merchant.id, body), { body: promotionBody }
  )
  .put('/promotions/:id', async ({ params, body, auth }) =>
    DiscountsService.updatePromotion(auth.merchant.id, params.id, body), { body: promotionUpdateBody }
  )
  .delete('/promotions/:id', async ({ params, auth }) =>
    DiscountsService.deletePromotion(auth.merchant.id, params.id)
  )