import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { RolesService } from './service'
import { createRoleBody, roleParams, updateRoleBody } from './model'

export const rolesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard())
  .get('/roles', async ({ auth }) => RolesService.list(auth.merchant.id))
  .use(outletGuard({ permissions: ['staff.manage'] }))
  .post('/roles', async ({ body, auth, request }) => {
    const result = await RolesService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, {
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
      const result = await RolesService.update(auth.merchant.id, params.roleId, body)
      auditFromRequest(auth, request, {
        action: 'role.update',
        entityType: 'role',
        entityId: params.roleId
      })
      return result
    },
    { params: roleParams, body: updateRoleBody }
  )
  .delete('/roles/:roleId', async ({ params, auth, request }) => {
    const result = await RolesService.remove(auth.merchant.id, params.roleId)
    auditFromRequest(auth, request, {
      action: 'role.delete',
      entityType: 'role',
      entityId: params.roleId
    })
    return result
  }, { params: roleParams })
