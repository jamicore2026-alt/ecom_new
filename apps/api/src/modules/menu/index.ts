import { Elysia, t } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { MenuService } from './service'
import {
  menuCreateBody,
  menuUpdateBody,
  menuParams,
  menuGroupParams,
  modifierGroupBody,
  modifierGroupUpdateBody,
  modifierBody,
  modifierUpdateBody,
  outletRuleBody,
  menuQuery
} from './model'

export const menuModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'restaurant', permissions: ['menu.read'] }))
  .get('/menu', async ({ query, auth }) => MenuService.list(auth.merchant.id, query), {
    query: menuQuery,
    detail: { summary: 'List menu items' }
  })
  .get('/menu/:id', async ({ params, auth }) => MenuService.get(auth.merchant.id, params.id), {
    params: menuParams,
    detail: { summary: 'Get a menu item with modifiers and outlet rules' }
  })
  .get('/modifier-groups', async ({ auth }) => MenuService.listGroups(auth.merchant.id), {
    detail: { summary: 'List modifier groups with their modifiers' }
  })

  .use(outletGuard({ module: 'restaurant', permissions: ['menu.manage'] }))
  .post('/menu', async ({ body, auth, request }) => {
    const result = await MenuService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, {
      action: 'menu.create',
      entityType: 'menu_item',
      entityId: (result.data as { id: string }).id
    })
    return result
  }, { body: menuCreateBody })
  .put('/menu/:id', async ({ params, body, auth, request }) => {
    const result = await MenuService.update(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'menu.update', entityType: 'menu_item', entityId: params.id })
    return result
  }, { params: menuParams, body: menuUpdateBody })
  .delete('/menu/:id', async ({ params, auth, request }) => {
    const result = await MenuService.remove(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'menu.archive', entityType: 'menu_item', entityId: params.id })
    return result
  }, { params: menuParams })
  .post('/menu/:id/modifiers', async ({ params, body, auth, request }) => {
    const result = await MenuService.bindModifierGroup(auth.merchant.id, params.id, body.groupId)
    auditFromRequest(auth, request, { action: 'menu.bind_modifier', entityType: 'menu_item', entityId: params.id })
    return result
  }, { params: menuParams, body: t.Object({ groupId: t.String() }) })
  .delete('/menu/:id/modifiers/:groupId', async ({ params, auth, request }) => {
    const result = await MenuService.unbindModifierGroup(auth.merchant.id, params.id, params.groupId)
    auditFromRequest(auth, request, { action: 'menu.unbind_modifier', entityType: 'menu_item', entityId: params.id })
    return result
  }, { params: menuGroupParams })
  .post('/menu/:id/outlets', async ({ params, body, auth, request }) => {
    const result = await MenuService.setOutletRule(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'menu.outlet_rule', entityType: 'menu_item', entityId: params.id })
    return result
  }, { params: menuParams, body: outletRuleBody })

  .post('/modifier-groups', async ({ body, auth, request }) => {
    const result = await MenuService.createGroup(auth.merchant.id, body)
    auditFromRequest(auth, request, { action: 'modifier_group.create', entityType: 'modifier_group', entityId: (result.data as { id: string }).id })
    return result
  }, { body: modifierGroupBody })
  .put('/modifier-groups/:id', async ({ params, body, auth, request }) => {
    const result = await MenuService.updateGroup(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'modifier_group.update', entityType: 'modifier_group', entityId: params.id })
    return result
  }, { params: menuParams, body: modifierGroupUpdateBody })
  .delete('/modifier-groups/:id', async ({ params, auth, request }) => {
    const result = await MenuService.removeGroup(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'modifier_group.delete', entityType: 'modifier_group', entityId: params.id })
    return result
  }, { params: menuParams })
  .post('/modifier-groups/:id/modifiers', async ({ params, body, auth, request }) => {
    const result = await MenuService.addModifier(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'modifier.create', entityType: 'modifier', entityId: (result.data as { id: string }).id })
    return result
  }, { params: menuParams, body: modifierBody })
  .put('/modifiers/:id', async ({ params, body, auth, request }) => {
    const result = await MenuService.updateModifier(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'modifier.update', entityType: 'modifier', entityId: params.id })
    return result
  }, { params: menuParams, body: modifierUpdateBody })
  .delete('/modifiers/:id', async ({ params, auth, request }) => {
    const result = await MenuService.removeModifier(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'modifier.delete', entityType: 'modifier', entityId: params.id })
    return result
  }, { params: menuParams })
