import { Elysia } from 'elysia'
import { authPlugin, isAdmin } from '../../plugins/auth'
import { SettingsService } from './service'
import {
  paymentBody,
  providerBody,
  providerParams,
  shippingBody,
  staffCreateBody,
  staffUpdateBody,
  storeBody,
  taxBody
} from './model'
import { forbidden } from '../../shared/errors'

const requireAdmin = new Elysia({ name: 'require-admin' })
  .use(authPlugin)
  .derive({ as: 'scoped' }, ({ auth }) => {
    if (!auth) throw forbidden('Unauthenticated')
    if (!isAdmin(auth)) throw forbidden('Admin access required')
  })

export const settingsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .group('/settings', (app) =>
    app
      .use(requireAdmin)
      .get('/store', async ({ auth }) => SettingsService.getStore(auth.merchant.id))
      .put('/store', async ({ body, auth }) => SettingsService.updateStore(auth.merchant.id, body), {
        body: storeBody
      })
      .get('/payments', async ({ auth }) => SettingsService.getPayments(auth.merchant.id))
      .put('/payments', async ({ body, auth }) => SettingsService.updatePayments(auth.merchant.id, body), {
        body: paymentBody
      })
      .get(
        '/payments/providers',
        async ({ auth }) => SettingsService.listPaymentProviders(auth.merchant.id)
      )
      .put(
        '/payments/providers/:provider',
        async ({ params, body, auth }) =>
          SettingsService.updatePaymentProvider(auth.merchant.id, params.provider, body),
        { body: providerBody, params: providerParams }
      )
      .post(
        '/payments/providers/:provider/test',
        async ({ params, auth }) => SettingsService.testPaymentProvider(auth.merchant.id, params.provider),
        { params: providerParams }
      )
      .get('/shipping', async ({ auth }) => SettingsService.getShipping(auth.merchant.id))
      .put('/shipping', async ({ body, auth }) => SettingsService.updateShipping(auth.merchant.id, body), {
        body: shippingBody
      })
      .get('/taxes', async ({ auth }) => SettingsService.getTaxes(auth.merchant.id))
      .put('/taxes', async ({ body, auth }) => SettingsService.updateTaxes(auth.merchant.id, body), {
        body: taxBody
      })
      .get('/staff', async ({ auth }) => SettingsService.listStaff(auth.merchant.id))
      .post('/staff', async ({ body, auth }) => SettingsService.createStaff(auth.merchant.id, body), {
        body: staffCreateBody
      })
      .put('/staff/:id', async ({ params, body, auth }) =>
        SettingsService.updateStaff(auth.merchant.id, params.id, body, auth.user), { body: staffUpdateBody }
      )
      .delete('/staff/:id', async ({ params, auth }) =>
        SettingsService.deleteStaff(auth.merchant.id, params.id, auth.user)
      )
  )