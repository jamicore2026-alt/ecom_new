import { t } from 'elysia'
import { KITCHEN_ITEM_STATUSES, KITCHEN_PRIORITIES, KITCHEN_STATION_STATUSES, KOT_STATUSES } from '../../shared/types'

const kotStatusEnum = Object.fromEntries(KOT_STATUSES.map((s) => [s, s]))
const priorityEnum = Object.fromEntries(KITCHEN_PRIORITIES.map((s) => [s, s]))
const itemStatusEnum = Object.fromEntries(KITCHEN_ITEM_STATUSES.map((s) => [s, s]))
const stationStatusEnum = Object.fromEntries(KITCHEN_STATION_STATUSES.map((s) => [s, s]))

export const kitchenParams = t.Object({ id: t.String() })

export const kitchenStationBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  outletId: t.Optional(t.String()),
  prepSlaMin: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
  sortOrder: t.Optional(t.Number()),
  status: t.Optional(t.Enum(stationStatusEnum))
})
export const kitchenStationUpdateBody = t.Partial(
  t.Object({
    name: t.String({ minLength: 1, maxLength: 100 }),
    outletId: t.Optional(t.String()),
    prepSlaMin: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
    sortOrder: t.Optional(t.Number()),
    status: t.Optional(t.Enum(stationStatusEnum))
  })
)
export const kitchenStationQuery = t.Object({ outletId: t.Optional(t.String()) })

export const kotStatusBody = t.Object({ status: t.Enum(kotStatusEnum) })
export const kotPriorityBody = t.Object({ priority: t.Enum(priorityEnum) })
export const kotItemStatusBody = t.Object({ status: t.Enum(itemStatusEnum) })

export const kotTicketQuery = t.Object({
  outletId: t.Optional(t.String()),
  stationId: t.Optional(t.String()),
  status: t.Optional(t.String()),
  search: t.Optional(t.String()),
  page: t.Optional(t.Number()),
  limit: t.Optional(t.Number())
})

export const kotGenerateBody = t.Object({
  priority: t.Optional(t.Enum(priorityEnum))
})
