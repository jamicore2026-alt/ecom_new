import { t } from 'elysia'
import { TABLE_STATES, TABLE_SESSION_STATUSES } from '../../shared/types'

const tableStateEnum = Object.fromEntries(TABLE_STATES.map((s) => [s, s]))
const sessionStatusEnum = Object.fromEntries(TABLE_SESSION_STATUSES.map((s) => [s, s]))

export const tableParams = t.Object({ id: t.String() })

export const tableQuery = t.Object({
  outletId: t.Optional(t.String()),
  sectionId: t.Optional(t.String()),
  status: t.Optional(t.String())
})

export const tableSectionBody = t.Object({
  outletId: t.String(),
  name: t.String({ minLength: 1, maxLength: 120 }),
  sortOrder: t.Optional(t.Number()),
  status: t.Optional(t.Union([t.Literal('active'), t.Literal('inactive')]))
})
export const tableSectionUpdateBody = t.Partial(
  t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }),
    sortOrder: t.Optional(t.Number()),
    status: t.Optional(t.Union([t.Literal('active'), t.Literal('inactive')]))
  })
)

export const tableCreateBody = t.Object({
  outletId: t.String(),
  sectionId: t.Optional(t.String()),
  name: t.String({ minLength: 1, maxLength: 60 }),
  code: t.String({ minLength: 1, maxLength: 30 }),
  seats: t.Number({ minimum: 1, maximum: 99 })
})
export const tableUpdateBody = t.Partial(
  t.Object({
    sectionId: t.Optional(t.String()),
    name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
    code: t.Optional(t.String({ minLength: 1, maxLength: 30 })),
    seats: t.Optional(t.Number({ minimum: 1, maximum: 99 }))
  })
)
export const tableStatusBody = t.Object({
  status: t.Enum(tableStateEnum)
})

export const sessionOpenBody = t.Object({
  tableId: t.String(),
  guests: t.Optional(t.Number({ minimum: 1, maximum: 999 })),
  notes: t.Optional(t.String({ maxLength: 2000 }))
})
export const sessionMoveBody = t.Object({ toTableId: t.String() })
export const sessionMergeBody = t.Object({ sessionIds: t.Array(t.String(), { minItems: 1 }) })
export const sessionSplitBody = t.Object({
  toTableId: t.String(),
  guests: t.Number({ minimum: 1, maximum: 999 })
})
export const sessionStatusBody = t.Object({
  status: t.Enum(sessionStatusEnum)
})
export const sessionOrderAttachBody = t.Object({ orderId: t.String() })

export const sessionQuery = t.Object({
  status: t.Optional(t.String()),
  outletId: t.Optional(t.String()),
  tableId: t.Optional(t.String())
})

export const qrUrlBody = t.Object({ baseUrl: t.Optional(t.String()) })
