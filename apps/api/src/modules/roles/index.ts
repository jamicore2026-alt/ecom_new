import { Elysia } from 'elysia'
import { authPlugin, hasPermission } from '../../plugins/auth'
import type { AuthContext } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { forbidden } from '../../shared/errors'
import { auditFromRequest } from '../audit-logs'
import { RolesService } from './service'
import { createRoleBody, roleParams, updateRoleBody } from './model'

/** Enumeration guard: role definitions (names/scopes/permissions) are only
 *  visible to staff.read holders. Owner/admin bypass via hasPermission. */
const needStaffRead = ({ auth }: { auth: AuthContext }) => {
  if (!hasPermission(auth, 'staff.read')) throw forbidden()
}

export const rolesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard())
  .get('/roles', async ({ auth }) => RolesService.list(auth.db, auth.merchant.id), {
    beforeHandle: needStaffRead
  })
  .use(outletGuard({ permissions: ['staff.manage'] }))
  .post('/roles', async ({ body, auth, request }) => {
    const result = await RolesService.create(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
      action: 'role.create',
      entityType: 'role',
      entityId: result.data.id,
      metadata: { name: body.name, scope: body.scope }
    })
    return result
  }, { body: createRoleBody })
  .put(
    '/roles/:roleId',
    async ({ params, body, auth, request }) => {
      const result = await RolesService.update(auth.db, auth.merchant.id, params.roleId, body)
      await auditFromRequest(auth, request, {
        action: 'role.update',
        entityType: 'role',
        entityId: params.roleId
      })
      return result
    },
    { params: roleParams, body: updateRoleBody }
  )
  .delete('/roles/:roleId', async ({ params, auth, request }) => {
    const result = await RolesService.remove(auth.db, auth.merchant.id, params.roleId)
    await auditFromRequest(auth, request, {
      action: 'role.delete',
      entityType: 'role',
      entityId: params.roleId
    })
    return result
  }, { params: roleParams })
