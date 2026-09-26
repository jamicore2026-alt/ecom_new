import { Elysia } from 'elysia'
import { authPlugin, hasPermission } from '../../plugins/auth'
import type { AuthContext } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { forbidden } from '../../shared/errors'
import { auditFromRequest } from '../audit-logs'
import { OutletsService } from './service'
import { createOutletBody, outletParams, updateOutletBody } from './model'

/** Enumeration guard: the merchant-wide outlet list (ids/codes/addresses)
 *  requires staff.read. The self-scoped /outlets/my stays open (own scope).
 *  Owner/admin bypass via hasPermission. */
const needStaffRead = ({ auth }: { auth: AuthContext }) => {
  if (!hasPermission(auth, 'staff.read')) throw forbidden()
}

export const outletsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard())
  .get('/outlets', async ({ auth }) => OutletsService.list(auth.db, auth.merchant.id), {
    detail: { summary: 'List all merchant outlets' },
    beforeHandle: needStaffRead
  })
  // registered before '/outlets/:outletId' so "my" is not captured as an id
  .get('/outlets/my', async ({ auth, merchantContext }) => OutletsService.listAllowed(auth.db, merchantContext), {
    detail: { summary: 'List outlets scoped to the current user' }
  })
  .get(
    '/outlets/:outletId',
    async ({ params, auth }) => OutletsService.get(auth.db, auth.merchant.id, params.outletId),
    { params: outletParams, beforeHandle: needStaffRead }
  )
  .use(outletGuard({ permissions: ['staff.manage'] }))
  .post('/outlets', async ({ body, auth, request }) => {
    const result = await OutletsService.create(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
      action: 'outlet.create',
      entityType: 'outlet',
      entityId: result.data.id,
      metadata: { name: body.name, code: body.code }
    })
    return result
  }, { body: createOutletBody })
  .put(
    '/outlets/:outletId',
    async ({ params, body, auth, request }) => {
      const result = await OutletsService.update(auth.db, auth.merchant.id, params.outletId, body)
      await auditFromRequest(auth, request, {
        action: 'outlet.update',
        entityType: 'outlet',
        entityId: params.outletId
      })
      return result
    },
    { params: outletParams, body: updateOutletBody }
  )
  .delete('/outlets/:outletId', async ({ params, auth, request }) => {
    const result = await OutletsService.archive(auth.db, auth.merchant.id, params.outletId)
    await auditFromRequest(auth, request, {
      action: 'outlet.archive',
      entityType: 'outlet',
      entityId: params.outletId
    })
    return result
  }, { params: outletParams })
