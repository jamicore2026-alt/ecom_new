import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { RegisterShiftsService } from './service'
import {
  registerParams,
  registerOpenBody,
  registerMovementBody,
  registerCloseBody,
  registerQuery,
  registerCurrentQuery
} from './model'

export const registerModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'restaurant', permissions: ['payments.read'] }))
  .get('/register-shifts', async ({ query, auth, merchantContext }) => RegisterShiftsService.list(auth.db, auth.merchant.id, query, merchantContext), {
    query: registerQuery,
    detail: { summary: 'List register shifts' }
  })
  .get('/register-shifts/current', async ({ query, auth, merchantContext }) => RegisterShiftsService.current(auth.db, auth.merchant.id, query.outletId, merchantContext), {
    query: registerCurrentQuery,
    detail: { summary: 'Get the open shift for an outlet' }
  })
  .get('/register-shifts/:id', async ({ params, auth, merchantContext }) => RegisterShiftsService.get(auth.db, auth.merchant.id, params.id, merchantContext), {
    params: registerParams,
    detail: { summary: 'Get a register shift' }
  })

  /* Cash-drawer writes: payments.create (cashier/cash-handling surface). */
  .use(outletGuard({ module: 'restaurant', permissions: ['payments.create'] }))
  .post('/register-shifts/open', async ({ body, auth, request, merchantContext }) => {
    const result = await RegisterShiftsService.open(auth.db, auth.merchant.id, auth.user.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'register_shift.open', entityType: 'register_shift', entityId: (result.data as { id: string }).id })
    return result
  }, { body: registerOpenBody })
  .post('/register-shifts/:id/drop', async ({ params, body, auth, request, merchantContext }) => {
    const result = await RegisterShiftsService.recordDrop(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'register_shift.drop', entityType: 'register_shift', entityId: params.id, metadata: { amount: body.amount } })
    return result
  }, { params: registerParams, body: registerMovementBody })
  .post('/register-shifts/:id/payout', async ({ params, body, auth, request, merchantContext }) => {
    const result = await RegisterShiftsService.recordPayout(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'register_shift.payout', entityType: 'register_shift', entityId: params.id, metadata: { amount: body.amount } })
    return result
  }, { params: registerParams, body: registerMovementBody })
  .post('/register-shifts/:id/close', async ({ params, body, auth, request, merchantContext }) => {
    const result = await RegisterShiftsService.close(auth.db, auth.merchant.id, auth.user.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'register_shift.close', entityType: 'register_shift', entityId: params.id, metadata: { actualCash: body.actualCash } })
    return result
  }, { params: registerParams, body: registerCloseBody })
