import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { ModulesService } from './service'
import { moduleParams, setModuleEnabledBody } from './model'

export const modulesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/modules', async ({ auth }) => ModulesService.list(auth.merchant.id))
  .use(outletGuard({ permissions: ['settings.manage'] }))
  .put(
    '/modules/:module',
    async ({ params, body, auth, request }) => {
      const result = await ModulesService.setEnabled(auth.merchant.id, params.module, body.enabled)
      auditFromRequest(auth, request, {
        action: 'module.set_enabled',
        entityType: 'module',
        entityId: params.module,
        metadata: { enabled: body.enabled }
      })
      return result
    },
    { params: moduleParams, body: setModuleEnabledBody }
  )
