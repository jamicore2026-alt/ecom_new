import { t } from 'elysia'

export const setModuleEnabledBody = t.Object({
  enabled: t.Boolean()
})

export const moduleParams = t.Object({ module: t.String() })
