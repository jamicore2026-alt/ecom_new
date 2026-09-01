import { and, desc, eq, inArray, ilike, count } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  menuItems,
  products,
  modifierGroups,
  modifiers,
  menuItemModifiers,
  menuItemOutlets,
  outlets,
  categories
} from '../../database/schema'
import { ok } from '../../shared/response'
import { parsePagination, makeMeta } from '../../shared/pagination'
import { notFound, conflict, badRequest } from '../../shared/errors'

export class MenuService {
  static async list(merchantId: string, query: { search?: string; status?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = parsePagination(query)
    const conds = [eq(menuItems.merchantId, merchantId)]
    if (query.status) conds.push(eq(menuItems.status, query.status))
    if (query.search) conds.push(ilike(products.name, `%${query.search.trim()}%`))

    const where = and(...conds)
    const [{ value: total }] = await db.select({ value: count() }).from(menuItems)
      .innerJoin(products, eq(menuItems.productId, products.id))
      .where(where)
    const rows = await db.select({
      id: menuItems.id,
      available: menuItems.available,
      preparationTimeMin: menuItems.preparationTimeMin,
      kitchenStation: menuItems.kitchenStation,
      dietaryTags: menuItems.dietaryTags,
      allergens: menuItems.allergens,
      taxRate: menuItems.taxRate,
      sortOrder: menuItems.sortOrder,
      status: menuItems.status,
      availability: menuItems.availability,
      createdAt: menuItems.createdAt,
      updatedAt: menuItems.updatedAt,
      product: products
    }).from(menuItems)
      .innerJoin(products, eq(menuItems.productId, products.id))
      .where(where)
      .orderBy(desc(menuItems.createdAt))
      .limit(limit)
      .offset(offset)

    const groupsById = await this.attachGroups(merchantId, rows)
    const items = groupsById.size
      ? rows.map((r) => ({ ...r, modifierGroups: groupsById.get(r.id) ?? [] }))
      : rows

    return ok({ items, meta: makeMeta(page, limit, total) })
  }

  private static async attachGroups(merchantId: string, items: { id: string }[]) {
    if (items.length === 0) return new Map<string, (typeof modifierGroups.$inferSelect & { modifiers: (typeof modifiers.$inferSelect)[] })[]>()
    const menuIds = items.map((i) => i.id)
    const links = await db
      .select({ menuItemId: menuItemModifiers.menuItemId, group: modifierGroups, sortOrder: menuItemModifiers.sortOrder })
      .from(menuItemModifiers)
      .innerJoin(modifierGroups, eq(menuItemModifiers.modifierGroupId, modifierGroups.id))
      .where(and(inArray(menuItemModifiers.menuItemId, menuIds), eq(modifierGroups.merchantId, merchantId)))
      .orderBy(desc(menuItemModifiers.sortOrder))
    if (links.length === 0) return new Map()
    const groupIds = [...new Set(links.map((l) => l.group.id))]
    const mods = await db.select().from(modifiers).where(and(inArray(modifiers.modifierGroupId, groupIds), eq(modifiers.merchantId, merchantId)))
    const out = new Map<string, (typeof modifierGroups.$inferSelect & { modifiers: (typeof modifiers.$inferSelect)[] })[]>()
    for (const l of links) {
      const entry = { ...l.group, modifiers: mods.filter((m) => m.modifierGroupId === l.group.id) }
      if (!out.has(l.menuItemId)) out.set(l.menuItemId, [])
      out.get(l.menuItemId)!.push(entry)
    }
    return out
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select({
        id: menuItems.id,
        available: menuItems.available,
        preparationTimeMin: menuItems.preparationTimeMin,
        kitchenStation: menuItems.kitchenStation,
        dietaryTags: menuItems.dietaryTags,
        allergens: menuItems.allergens,
        taxRate: menuItems.taxRate,
        sortOrder: menuItems.sortOrder,
        status: menuItems.status,
        availability: menuItems.availability,
        createdAt: menuItems.createdAt,
        updatedAt: menuItems.updatedAt,
        product: products,
        category: categories,
        categoryId: products.categoryId
      })
      .from(menuItems)
      .innerJoin(products, eq(menuItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(menuItems.id, id), eq(menuItems.merchantId, merchantId)))
    if (!row) throw notFound('NOT_FOUND', 'Menu item not found')

    // Fetch current merchant's default outlet for display context (optional).
    const groups = await this.groupsForItem(merchantId, id)
    const outlets = await db
      .select()
      .from(menuItemOutlets)
      .where(eq(menuItemOutlets.menuItemId, id))
    return ok({ ...row, modifierGroups: groups, outletRules: outlets })
  }

  static async create(merchantId: string, input: {
    productId: string
    available?: boolean
    preparationTimeMin?: number
    kitchenStation?: string
    dietaryTags?: string[]
    allergens?: string[]
    taxRate?: number
    sortOrder?: number
    status?: string
    availability?: unknown[]
  }) {
    const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.merchantId, merchantId)))
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found')

    const [existing] = await db.select().from(menuItems).where(and(eq(menuItems.merchantId, merchantId), eq(menuItems.productId, input.productId)))
    if (existing) throw conflict('MENU_ITEM_EXISTS', 'This product is already on the menu')

    const [row] = await db.insert(menuItems).values({
      merchantId,
      productId: input.productId,
      available: input.available ?? true,
      preparationTimeMin: input.preparationTimeMin ?? 0,
      kitchenStation: input.kitchenStation ?? null,
      dietaryTags: input.dietaryTags ?? [],
      allergens: input.allergens ?? [],
      taxRate: input.taxRate ?? 0,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active',
      availability: (input.availability ?? []) as never
    }).returning()

    return this.get(merchantId, row.id)
  }

  static async update(merchantId: string, id: string, input: Record<string, unknown>) {
    const [existing] = await db.select().from(menuItems).where(and(eq(menuItems.id, id), eq(menuItems.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Menu item not found')

    const set: Record<string, unknown> = {}
    for (const key of ['available', 'preparationTimeMin', 'kitchenStation', 'dietaryTags', 'allergens', 'taxRate', 'sortOrder', 'status'] as const) {
      if (input[key] !== undefined) set[key] = input[key]
    }
    if (input.productId !== undefined) throw badRequest('IMMUTABLE_PRODUCT', 'Product binding cannot be changed')
    if (input.availability !== undefined) set.availability = input.availability as never

    const [row] = await db.update(menuItems).set(set).where(and(eq(menuItems.id, id), eq(menuItems.merchantId, merchantId))).returning()
    return this.get(merchantId, row.id)
  }

  static async remove(merchantId: string, id: string) {
    const [existing] = await db.select().from(menuItems).where(and(eq(menuItems.id, id), eq(menuItems.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Menu item not found')
    const [row] = await db.update(menuItems).set({ status: 'archived' }).where(and(eq(menuItems.id, id), eq(menuItems.merchantId, merchantId))).returning()
    return ok(row)
  }

  private static async groupsForItem(merchantId: string, menuItemId: string) {
    const links = await db
      .select({ group: modifierGroups, sortOrder: menuItemModifiers.sortOrder })
      .from(menuItemModifiers)
      .innerJoin(modifierGroups, eq(menuItemModifiers.modifierGroupId, modifierGroups.id))
      .where(and(eq(menuItemModifiers.menuItemId, menuItemId), eq(modifierGroups.merchantId, merchantId)))
      .orderBy(desc(menuItemModifiers.sortOrder))
    const ids = links.map((l) => l.group.id)
    const mods = ids.length
      ? await db.select().from(modifiers).where(and(inArray(modifiers.modifierGroupId, ids), eq(modifiers.merchantId, merchantId)))
      : []
    return links.map((l) => ({ ...l.group, modifiers: mods.filter((m) => m.modifierGroupId === l.group.id) }))
  }

  /* ------------------------------ modifiers ------------------------------ */

  static async bindModifierGroup(merchantId: string, menuItemId: string, groupId: string) {
    const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, menuItemId), eq(menuItems.merchantId, merchantId)))
    if (!item) throw notFound('NOT_FOUND', 'Menu item not found')
    const [group] = await db.select().from(modifierGroups).where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.merchantId, merchantId)))
    if (!group) throw notFound('GROUP_NOT_FOUND', 'Modifier group not found')

    const [link] = await db.select().from(menuItemModifiers).where(and(eq(menuItemModifiers.menuItemId, menuItemId), eq(menuItemModifiers.modifierGroupId, groupId)))
    if (link) throw conflict('ALREADY_BOUND', 'Modifier group already bound to this item')
    await db.insert(menuItemModifiers).values({ merchantId, menuItemId, modifierGroupId: groupId })
    return this.get(merchantId, menuItemId)
  }

  static async unbindModifierGroup(merchantId: string, menuItemId: string, groupId: string) {
    const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, menuItemId), eq(menuItems.merchantId, merchantId)))
    if (!item) throw notFound('NOT_FOUND', 'Menu item not found')
    await db.delete(menuItemModifiers).where(and(eq(menuItemModifiers.menuItemId, menuItemId), eq(menuItemModifiers.modifierGroupId, groupId)))
    return this.get(merchantId, menuItemId)
  }

  static async setOutletRule(merchantId: string, menuItemId: string, input: { outletId: string; available?: boolean; priceAdjustment?: number }) {
    const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, menuItemId), eq(menuItems.merchantId, merchantId)))
    if (!item) throw notFound('NOT_FOUND', 'Menu item not found')
    const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
    if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')

    const [existing] = await db.select().from(menuItemOutlets).where(and(eq(menuItemOutlets.menuItemId, menuItemId), eq(menuItemOutlets.outletId, input.outletId)))
    const values = { available: input.available ?? true, priceAdjustment: input.priceAdjustment ?? 0 }
    if (existing) {
      await db.update(menuItemOutlets).set(values).where(eq(menuItemOutlets.id, existing.id))
    } else {
      await db.insert(menuItemOutlets).values({ merchantId, menuItemId, outletId: input.outletId, ...values })
    }
    return this.get(merchantId, menuItemId)
  }

  /* --------------------------- modifier groups --------------------------- */

  static async listGroups(merchantId: string) {
    const rows = await db.select().from(modifierGroups).where(eq(modifierGroups.merchantId, merchantId)).orderBy(desc(modifierGroups.sortOrder))
    const ids = rows.map((r) => r.id)
    const mods = ids.length ? await db.select().from(modifiers).where(and(inArray(modifiers.modifierGroupId, ids), eq(modifiers.merchantId, merchantId))) : []
    return ok(rows.map((g) => ({ ...g, modifiers: mods.filter((m) => m.modifierGroupId === g.id) })))
  }

  static async createGroup(merchantId: string, input: { name: string; required?: boolean; minSelections?: number; maxSelections?: number; sortOrder?: number; status?: string }) {
    const [row] = await db.insert(modifierGroups).values({
      merchantId,
      name: input.name,
      required: input.required ?? false,
      minSelections: input.minSelections ?? 0,
      maxSelections: input.maxSelections ?? 1,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active'
    }).returning()
    return ok(row)
  }

  static async updateGroup(merchantId: string, id: string, input: Record<string, unknown>) {
    const [existing] = await db.select().from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Modifier group not found')
    const [row] = await db.update(modifierGroups).set(input).where(and(eq(modifierGroups.id, id), eq(modifierGroups.merchantId, merchantId))).returning()
    return ok(row)
  }

  static async removeGroup(merchantId: string, id: string) {
    const [existing] = await db.select().from(modifierGroups).where(and(eq(modifierGroups.id, id), eq(modifierGroups.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Modifier group not found')
    await db.delete(modifierGroups).where(eq(modifierGroups.id, id))
    return ok({ id })
  }

  static async addModifier(merchantId: string, groupId: string, input: { name: string; priceAdjustment?: number; available?: boolean; sortOrder?: number; status?: string }) {
    const [group] = await db.select().from(modifierGroups).where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.merchantId, merchantId)))
    if (!group) throw notFound('NOT_FOUND', 'Modifier group not found')
    const [row] = await db.insert(modifiers).values({
      merchantId,
      modifierGroupId: groupId,
      name: input.name,
      priceAdjustment: input.priceAdjustment ?? 0,
      available: input.available ?? true,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active'
    }).returning()
    return ok(row)
  }

  static async updateModifier(merchantId: string, id: string, input: Record<string, unknown>) {
    const [existing] = await db.select().from(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Modifier not found')
    const [row] = await db.update(modifiers).set(input).where(and(eq(modifiers.id, id), eq(modifiers.merchantId, merchantId))).returning()
    return ok(row)
  }

  static async removeModifier(merchantId: string, id: string) {
    const [existing] = await db.select().from(modifiers).where(and(eq(modifiers.id, id), eq(modifiers.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Modifier not found')
    await db.delete(modifiers).where(eq(modifiers.id, id))
    return ok({ id })
  }
}
