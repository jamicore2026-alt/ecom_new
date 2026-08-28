import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { OutletsService } from './service'
import { createOutletBody, outletParams, updateOutletBody } from './model'

export const outletsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard())
  .get('/outlets', async ({ auth }) => OutletsService.list(auth.merchant.id), {
    detail: { summary: 'List all merchant outlets' }
  })
  // registered before '/outlets/:outletId' so "my" is not captured as an id
  .get('/outlets/my', async ({ merchantContext }) => OutletsService.listAllowed(merchantContext), {
    detail: { summary: 'List outlets scoped to the current user' }
  })
  .get(
    '/outlets/:outletId',
    async ({ params, auth }) => OutletsService.get(auth.merchant.id, params.outletId),
    { params: outletParams }
  )
  .use(outletGuard({ permissions: ['staff.manage'] }))
  .post('/outlets', async ({ body, auth, request }) => {
    const result = await OutletsService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, {
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
      const result = await OutletsService.update(auth.merchant.id, params.outletId, body)
      auditFromRequest(auth, request, {
        action: 'outlet.update',
        entityType: 'outlet',
        entityId: params.outletId
      })
      return result
    },
    { params: outletParams, body: updateOutletBody }
  )
  .delete('/outlets/:outletId', async ({ params, auth, request }) => {
    const result = await OutletsService.archive(auth.merchant.id, params.outletId)
    auditFromRequest(auth, request, {
      action: 'outlet.archive',
      entityType: 'outlet',
      entityId: params.outletId
    })
    return result
  }, { params: outletParams })
