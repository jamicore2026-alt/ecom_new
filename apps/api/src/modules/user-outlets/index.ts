import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { UserOutletsService } from './service'
import { assignOutletsBody, userParams } from './model'

export const userOutletsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard())
  .get(
    '/user-outlets/:userId',
    async ({ params, auth }) =>
      UserOutletsService.listForUser(auth.merchant.id, params.userId),
    { params: userParams, detail: { summary: 'List explicit outlet assignments for a user' } }
  )
  .use(outletGuard({ permissions: ['staff.manage'] }))
  .put(
    '/user-outlets/:userId',
    async ({ params, body, auth, request }) => {
      const result = await UserOutletsService.assign(
        auth.merchant.id,
        params.userId,
        body.outletIds
      )
      auditFromRequest(auth, request, {
        action: 'user_outlets.assign',
        entityType: 'user',
        entityId: params.userId,
        metadata: { outlets: body.outletIds }
      })
      return result
    },
    { params: userParams, body: assignOutletsBody }
  )
