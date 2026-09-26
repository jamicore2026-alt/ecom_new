import { Elysia } from 'elysia'
import { authPlugin, hasPermission, isAdmin } from '../../plugins/auth'
import type { AuthContext } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { forbidden } from '../../shared/errors'
import { auditFromRequest } from '../audit-logs'
import { UserOutletsService } from './service'
import { assignOutletsBody, userParams } from './model'

/** Enumeration guard: a user may read their OWN assignments; anyone else's
 *  requires staff.manage (owner/admin bypass via hasPermission/isAdmin). */
const needSelfOrStaffManage = ({ auth, params }: { auth: AuthContext; params: { userId: string } }) => {
  if (!auth) throw forbidden()
  if (auth.user.id === params.userId) return
  if (isAdmin(auth)) return
  if (!hasPermission(auth, 'staff.manage')) throw forbidden()
}

export const userOutletsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard())
  .get(
    '/user-outlets/:userId',
    async ({ params, auth }) =>
      UserOutletsService.listForUser(auth.db, auth.merchant.id, params.userId),
    { params: userParams, detail: { summary: 'List explicit outlet assignments for a user' }, beforeHandle: needSelfOrStaffManage }
  )
  .use(outletGuard({ permissions: ['staff.manage'] }))
  .put(
    '/user-outlets/:userId',
    async ({ params, body, auth, request }) => {
      const result = await UserOutletsService.assign(
        auth.db,
        auth.merchant.id,
        params.userId,
        body.outletIds
      )
      await auditFromRequest(auth, request, {
        action: 'user_outlets.assign',
        entityType: 'user',
        entityId: params.userId,
        metadata: { outlets: body.outletIds }
      })
      return result
    },
    { params: userParams, body: assignOutletsBody }
  )
