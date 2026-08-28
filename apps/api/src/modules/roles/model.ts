import { t } from 'elysia'
import { PERMISSIONS, SCOPES } from '../../shared/types'

// Only merchant-defined roles can be created/edited; system roles are immutable.
export const createRoleBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 50 }),
  permissions: t.Optional(t.Array(t.Enum({ ...Object.fromEntries(PERMISSIONS.map((p) => [p, p])) }))),
  scope: t.Optional(t.Enum({ ...Object.fromEntries(SCOPES.map((s) => [s, s])) }))
})

export const updateRoleBody = t.Partial(
  t.Object({
    name: t.String({ minLength: 1, maxLength: 50 }),
    permissions: t.Array(
      t.Enum({ ...Object.fromEntries(PERMISSIONS.map((p) => [p, p])) })
    ),
    scope: t.Enum({ ...Object.fromEntries(SCOPES.map((s) => [s, s])) })
  })
)

export const roleParams = t.Object({ roleId: t.String() })
