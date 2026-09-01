import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { LoyaltyService } from './service'
import { LoyaltyProgramService } from './program'

const adjustBody = t.Object({
  customerId: t.String(),
  points: t.Integer(),
  type: t.String({ minLength: 1 }),
  reference: t.Optional(t.String()),
  meta: t.Optional(t.Record(t.String(), t.Any()))
})

const tierBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  minPoints: t.Optional(t.Integer({ minimum: 0 })),
  perks: t.Optional(t.Record(t.String(), t.Any())),
  status: t.Optional(t.String())
})
const requiredTierBody = t.Object({
  name: t.String({ minLength: 1 }),
  minPoints: t.Integer({ minimum: 0 }),
  perks: t.Optional(t.Record(t.String(), t.Any())),
  status: t.Optional(t.String())
})

const ruleBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  trigger: t.Optional(t.String({ minLength: 1 })),
  awardType: t.Optional(t.String()),
  awardValue: t.Optional(t.Integer({ minimum: 0 })),
  enabled: t.Optional(t.Boolean())
})
const requiredRuleBody = t.Object({
  name: t.String({ minLength: 1 }),
  trigger: t.String({ minLength: 1 }),
  awardType: t.Optional(t.String()),
  awardValue: t.Optional(t.Integer({ minimum: 0 })),
  enabled: t.Optional(t.Boolean())
})

const rewardBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.String()),
  type: t.Optional(t.String()),
  pointsCost: t.Optional(t.Integer({ minimum: 0 })),
  status: t.Optional(t.String()),
  stock: t.Optional(t.Nullable(t.Integer({ minimum: 0 })))
})
const requiredRewardBody = t.Object({
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  type: t.Optional(t.String()),
  pointsCost: t.Optional(t.Integer({ minimum: 0 })),
  status: t.Optional(t.String()),
  stock: t.Optional(t.Nullable(t.Integer({ minimum: 0 })))
})

export const loyaltyModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('customers.read'))

  .get('/loyalty/overview', async ({ auth }) => LoyaltyService.overview(auth.merchant.id))
  .get('/loyalty/tiers', async ({ auth }) => LoyaltyProgramService.listTiers(auth.merchant.id))
  .get('/loyalty/rules', async ({ auth }) => LoyaltyProgramService.listRules(auth.merchant.id))
  .get('/loyalty/rewards', async ({ auth }) => LoyaltyProgramService.listRewards(auth.merchant.id))
  .get('/loyalty/:customerId', async ({ auth, params }) => LoyaltyService.getByCustomer(auth.merchant.id, params.customerId))
  .get('/loyalty/:customerId/ledger', async ({ auth, params }) => LoyaltyService.ledger(auth.merchant.id, params.customerId))

  .use(requirePermission('settings:write'))
  .post('/loyalty/adjust', async ({ auth, body }) => LoyaltyService.adjust(auth.merchant.id, body.customerId, body), { body: adjustBody })
  .post('/loyalty/tiers', async ({ auth, body }) => LoyaltyProgramService.createTier(auth.merchant.id, body), { body: requiredTierBody })
  .put('/loyalty/tiers/:id', async ({ auth, params, body }) => LoyaltyProgramService.updateTier(auth.merchant.id, params.id, body), { body: tierBody })
  .delete('/loyalty/tiers/:id', async ({ auth, params }) => LoyaltyProgramService.deleteTier(auth.merchant.id, params.id))
  .post('/loyalty/rules', async ({ auth, body }) => LoyaltyProgramService.createRule(auth.merchant.id, body), { body: requiredRuleBody })
  .put('/loyalty/rules/:id', async ({ auth, params, body }) => LoyaltyProgramService.updateRule(auth.merchant.id, params.id, body), { body: ruleBody })
  .delete('/loyalty/rules/:id', async ({ auth, params }) => LoyaltyProgramService.deleteRule(auth.merchant.id, params.id))
  .post('/loyalty/rewards', async ({ auth, body }) => LoyaltyProgramService.createReward(auth.merchant.id, body), { body: requiredRewardBody })
  .put('/loyalty/rewards/:id', async ({ auth, params, body }) => LoyaltyProgramService.updateReward(auth.merchant.id, params.id, body), { body: rewardBody })
  .delete('/loyalty/rewards/:id', async ({ auth, params }) => LoyaltyProgramService.deleteReward(auth.merchant.id, params.id))
