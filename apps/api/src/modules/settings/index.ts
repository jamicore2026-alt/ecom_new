import { Elysia, t } from 'elysia'
import { authPlugin, hasPermission, isAdmin } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { SettingsService } from './service'
import {
  carrierBody,
  checkoutBody,
  codRulesBody,
  invoiceSettingsBody,
  merchantBody,
  notificationsBody,
  paymentBody,
  providerBody,
  providerParams,
  shippingBody,
  staffCreateBody,
  staffInviteAcceptBody,
  staffInviteBody,
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

/**
 * Staff delegation: holders of the `staff.manage` permission may run staff
 * CRUD + invite flows. Owner/admin pass automatically because hasPermission
 * grants admins everything. This is intentionally narrower than requireAdmin
 * (which stays on financial/store settings below).
 */
const requireStaffManage = new Elysia({ name: 'require-staff-manage' })
  .use(authPlugin)
  .derive({ as: 'scoped' }, ({ auth }) => {
    if (!auth) throw forbidden('Unauthenticated')
    if (!hasPermission(auth, 'staff.manage')) throw forbidden('Staff management access required')
  })

export const settingsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .group('/settings', (app) =>
    app
      .use(requireAdmin)
      .get('/store', async ({ auth }) => SettingsService.getStore(auth.db, auth.merchant.id))
      .put('/store', async ({ body, auth, request }) => {
        const result = await SettingsService.updateStore(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.store.update',
          entityType: 'store_settings',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: storeBody
      })
      .get('/merchant', async ({ auth }) => SettingsService.getMerchant(auth.db, auth.merchant.id))
      .put('/merchant', async ({ body, auth, request }) => {
        const result = await SettingsService.updateMerchant(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.merchant.update',
          entityType: 'merchant',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: merchantBody
      })
      .get('/payments', async ({ auth }) => SettingsService.getPayments(auth.db, auth.merchant.id))
      .put('/payments', async ({ body, auth, request }) => {
        const result = await SettingsService.updatePayments(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.payments.update',
          entityType: 'payment_settings',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: paymentBody
      })
      .get(
        '/payments/providers',
        async ({ auth }) => SettingsService.listPaymentProviders(auth.db, auth.merchant.id)
      )
      .put(
        '/payments/providers/:provider',
        async ({ params, body, auth, request }) => {
          const result = await SettingsService.updatePaymentProvider(auth.db, auth.merchant.id, params.provider, body)
          await auditFromRequest(auth, request, {
            action: 'settings.payment_provider.update',
            entityType: 'payment_provider',
            entityId: params.provider
          })
          return result
        },
        { body: providerBody, params: providerParams }
      )
      .post(
        '/payments/providers/:provider/test',
        async ({ params, auth, request }) => {
          const result = await SettingsService.testPaymentProvider(auth.db, auth.merchant.id, params.provider)
          await auditFromRequest(auth, request, {
            action: 'settings.payment_provider.test',
            entityType: 'payment_provider',
            entityId: params.provider
          })
          return result
        },
        { params: providerParams }
      )
      .get('/shipping', async ({ auth }) => SettingsService.getShipping(auth.db, auth.merchant.id))
      .put('/shipping', async ({ body, auth, request }) => {
        const result = await SettingsService.updateShipping(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.shipping.update',
          entityType: 'shipping_settings',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: shippingBody
      })
      .get('/taxes', async ({ auth }) => SettingsService.getTaxes(auth.db, auth.merchant.id))
      .put('/taxes', async ({ body, auth, request }) => {
        const result = await SettingsService.updateTaxes(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.taxes.update',
          entityType: 'tax_settings',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: taxBody
      })
      .get('/cod', async ({ auth }) => SettingsService.getCodRules(auth.db, auth.merchant.id))
      .put('/cod', async ({ body, auth, request }) => {
        const result = await SettingsService.updateCodRules(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.cod.update',
          entityType: 'cod_rules',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: codRulesBody
      })
      .get('/checkout', async ({ auth }) => SettingsService.getCheckoutSettings(auth.db, auth.merchant.id))
      .put('/checkout', async ({ body, auth, request }) => {
        const result = await SettingsService.updateCheckoutSettings(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.checkout.update',
          entityType: 'checkout_settings',
          entityId: auth.merchant.id
        })
        return result
      }, {
        body: checkoutBody
      })
      .get('/invoice', async ({ auth }) => SettingsService.getInvoiceSettings(auth.db, auth.merchant.id))
      .put('/invoice', async ({ body, auth, request }) => {
        const result = await SettingsService.updateInvoiceSettings(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'invoice.settings.update',
          entityType: 'invoice_settings',
          entityId: auth.merchant.id
        })
        return result
      }, { body: invoiceSettingsBody })
      .get('/serviceability/:pincode', async ({ auth, params }) =>
        SettingsService.checkServiceability(auth.db, auth.merchant.id, params.pincode)
      )
      .get('/carriers', async ({ auth }) => SettingsService.listCarriers(auth.db, auth.merchant.id))
      .post('/carriers', async ({ body, auth, request }) => {
        const result = await SettingsService.createCarrier(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.carrier.create',
          entityType: 'carrier',
          entityId: result.data.id
        })
        return result
      }, {
        body: carrierBody
      })
      .put('/carriers/:id', async ({ params, body, auth, request }) => {
        const result = await SettingsService.updateCarrier(auth.db, auth.merchant.id, params.id, body)
        await auditFromRequest(auth, request, {
          action: 'settings.carrier.update',
          entityType: 'carrier',
          entityId: params.id
        })
        return result
      }, { body: carrierBody }
      )
      .delete('/carriers/:id', async ({ params, auth, request }) => {
        const result = await SettingsService.deleteCarrier(auth.db, auth.merchant.id, params.id)
        await auditFromRequest(auth, request, {
          action: 'settings.carrier.delete',
          entityType: 'carrier',
          entityId: params.id
        })
        return result
      })
      .get('/notifications', async ({ auth }) =>
        SettingsService.getNotifications(auth.db, auth.merchant.id)
      )
      .put(
        '/notifications',
        async ({ body, auth, request }) => {
          const result = await SettingsService.updateNotifications(auth.db, auth.merchant.id, body)
          await auditFromRequest(auth, request, {
            action: 'settings.notifications.update',
            entityType: 'notification_settings',
            entityId: auth.merchant.id
          })
          return result
        },
        { body: notificationsBody }
      )
  )
  // ---- staff CRUD + invites (staff.manage delegation, NOT admin-only) ----
  // Separate /settings group so requireAdmin above does NOT stack onto staff
  // routes (Elysia .use() guards accumulate). Owner/admin pass via
  // hasPermission('staff.manage') inside requireStaffManage.
  .group('/settings', (app) =>
    app
      .use(requireStaffManage)
      .get('/staff', async ({ auth }) => SettingsService.listStaff(auth.db, auth.merchant.id))
      .post('/staff', async ({ body, auth, request }) => {
        const result = await SettingsService.createStaff(auth.db, auth.merchant.id, body)
        await auditFromRequest(auth, request, {
          action: 'staff.create',
          entityType: 'staff',
          entityId: result.data.id
        })
        return result
      }, {
        body: staffCreateBody
      })
      .put('/staff/:id', async ({ params, body, auth, request }) => {
        const result = await SettingsService.updateStaff(auth.db, auth.merchant.id, params.id, body, auth.user)
        await auditFromRequest(auth, request, {
          action: 'staff.update',
          entityType: 'staff',
          entityId: params.id
        })
        return result
      }, { body: staffUpdateBody })
      .delete('/staff/:id', async ({ params, auth, request }) => {
        const result = await SettingsService.deleteStaff(auth.db, auth.merchant.id, params.id, auth.user)
        await auditFromRequest(auth, request, {
          action: 'staff.delete',
          entityType: 'staff',
          entityId: params.id
        })
        return result
      })
      .get('/staff/invites', async ({ auth }) => SettingsService.listInvites(auth.db, auth.merchant.id))
      .post('/staff/invite', async ({ body, auth, request }) => {
        const result = await SettingsService.createInvite(auth.db, auth.merchant.id, auth.user.id, body)
        await auditFromRequest(auth, request, {
          action: 'staff.invite',
          entityType: 'staff_invite',
          entityId: result.data.invite.id,
          metadata: { email: body.email }
        })
        return result
      }, { body: staffInviteBody })
      .post('/staff/invites/:id/resend', async ({ params, auth, request }) => {
        const result = await SettingsService.resendInvite(auth.db, auth.merchant.id, params.id)
        await auditFromRequest(auth, request, {
          action: 'staff.invite.resend',
          entityType: 'staff_invite',
          entityId: params.id
        })
        return result
      })
      .post('/staff/invites/:id/revoke', async ({ params, auth, request }) => {
        const result = await SettingsService.revokeInvite(auth.db, auth.merchant.id, params.id)
        await auditFromRequest(auth, request, {
          action: 'staff.invite.revoke',
          entityType: 'staff_invite',
          entityId: params.id
        })
        return result
      })
  )
  // Token-based accept is unauthenticated by design (invitee has no session
  // yet). It lives outside the /settings auth group.
  .post('/staff/invite/accept', async ({ body }) => SettingsService.acceptInvite(body.token, body), {
    body: t.Object({ token: t.String({ minLength: 10 }), ...staffInviteAcceptBody.properties }),
    detail: { summary: 'Accept a staff invitation (creates the user)' }
  })
