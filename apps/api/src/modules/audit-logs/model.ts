import { t } from 'elysia'

export const auditQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  action: t.Optional(t.String()),
  entityType: t.Optional(t.String()),
  entityId: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String())
})
