import { t } from 'elysia'

export const createSessionBody = t.Object({
  warehouseId: t.Optional(t.String()),
  notes: t.Optional(t.String())
})

export const addItemBody = t.Object({
  variantId: t.String(),
  countedQuantity: t.Optional(t.Integer({ minimum: 0 }))
})

export const setCountBody = t.Object({
  countedQuantity: t.Integer({ minimum: 0 })
})

export const sessionParams = t.Object({ id: t.String() })
export const itemParams = t.Object({ id: t.String(), itemId: t.String() })
