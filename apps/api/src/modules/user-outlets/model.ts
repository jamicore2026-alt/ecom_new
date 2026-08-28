import { t } from 'elysia'

export const assignOutletsBody = t.Object({
  outletIds: t.Array(t.String())
})

export const userParams = t.Object({ userId: t.String() })
