import { t } from 'elysia'

export const menuCreateBody = t.Object({
  productId: t.String(),
  available: t.Optional(t.Boolean()),
  preparationTimeMin: t.Optional(t.Number({ minimum: 0, maximum: 1440 })),
  kitchenStation: t.Optional(t.String({ maxLength: 100 })),
  dietaryTags: t.Optional(t.Array(t.String())),
  allergens: t.Optional(t.Array(t.String())),
  taxRate: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
  sortOrder: t.Optional(t.Number()),
  status: t.Optional(t.Enum({ active: 'active', inactive: 'inactive', archived: 'archived' })),
  availability: t.Optional(
    t.Array(
      t.Object({
        days: t.Array(t.Number({ minimum: 0, maximum: 6 })),
        start: t.String({ minLength: 1 }),
        end: t.String({ minLength: 1 })
      })
    )
  )
})

export const menuUpdateBody = t.Partial(menuCreateBody)

export const menuParams = t.Object({ id: t.String() })
export const menuGroupParams = t.Object({ id: t.String(), groupId: t.String() })

export const modifierGroupBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  required: t.Optional(t.Boolean()),
  minSelections: t.Optional(t.Number({ minimum: 0 })),
  maxSelections: t.Optional(t.Number({ minimum: 1 })),
  sortOrder: t.Optional(t.Number()),
  status: t.Optional(t.Enum({ active: 'active', inactive: 'inactive', archived: 'archived' }))
})

export const modifierGroupUpdateBody = t.Partial(modifierGroupBody)

export const modifierBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  priceAdjustment: t.Optional(t.Number()),
  available: t.Optional(t.Boolean()),
  sortOrder: t.Optional(t.Number()),
  status: t.Optional(t.Enum({ active: 'active', inactive: 'inactive', archived: 'archived' }))
})

export const modifierUpdateBody = t.Partial(modifierBody)

export const modifierParams = t.Object({ id: t.String(), modifierId: t.String() })

export const outletRuleBody = t.Object({
  outletId: t.String(),
  available: t.Optional(t.Boolean()),
  priceAdjustment: t.Optional(t.Number())
})

export const menuQuery = t.Object({
  search: t.Optional(t.String()),
  categoryId: t.Optional(t.String()),
  status: t.Optional(t.String()),
  page: t.Optional(t.Number()),
  limit: t.Optional(t.Number())
})
