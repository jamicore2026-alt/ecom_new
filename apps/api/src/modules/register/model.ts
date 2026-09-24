import { t } from 'elysia'

export const registerParams = t.Object({ id: t.String() })

export const registerOpenBody = t.Object({
  outletId: t.String(),
  openBank: t.Optional(t.Number({ minimum: 0 }))
})

export const registerMovementBody = t.Object({
  amount: t.Number({ exclusiveMinimum: 0 }),
  reason: t.Optional(t.String({ maxLength: 255 }))
})

export const registerCloseBody = t.Object({
  actualCash: t.Number({ minimum: 0 })
})

export const registerQuery = t.Object({
  outletId: t.Optional(t.String()),
  status: t.Optional(t.String()),
  page: t.Optional(t.Number()),
  limit: t.Optional(t.Number())
})

export const registerCurrentQuery = t.Object({
  outletId: t.String()
})
