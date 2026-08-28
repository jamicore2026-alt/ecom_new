import { hash } from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import { connection, db } from './client'
import {
  categories,
  coupons,  customers,
  inventoryLogs,
  kitchenStations,
  merchants,
  merchantModules,
  menuItemModifiers,
  menuItems,
  menuItemOutlets,
  modifierGroups,
  modifiers,
  orderItems,
  orders,
  outlets,
  paymentSettings,
  productVariants,
  products,
  promotions,
  refunds,
  returnsTable,
  roles,
  shippingSettings,
  storeSettings,
  tableSections,
  tables,
  taxSettings,
  userOutlets,
  users,
  visits
} from './schema'

import { DEFAULT_MODULES, DEFAULT_ROLES, type ModuleId } from '../shared/types'

/* --------------------------------- rng ---------------------------------- */

const mulberry32 = (a: number) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rand = mulberry32(1337)
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
const rnd = (n: number) => Math.round(rand() * n * 100) / 100

const DAY = 86400000
const daysAgo = (n: number, hour = 12) => {
  const d = new Date(Date.now() - n * DAY)
  d.setHours(hour, int(0, 59), int(0, 59), 0)
  return d
}

/* ------------------------------- catalog -------------------------------- */

const categoryDefs: Array<{ name: string; children?: string[] }> = [
  { name: 'Clothing', children: ["Men's Tops", "Women's Dresses"] },
  { name: 'Footwear', children: ['Sneakers'] },
  { name: 'Accessories', children: ['Watches'] },
  { name: 'Electronics', children: ['Headphones'] },
  { name: 'Home', children: ['Kitchen'] },
  { name: 'Beauty' },
  { name: 'Sports', children: ['Yoga'] },
  { name: 'Books' }
]

interface SeedProduct {
  name: string
  category: string
  price: number
  compareAt?: number
  sku: string
  cost?: number
  threshold?: number
  variants: Array<{ optionValues?: Record<string, string>; inventory: number; sku?: string }>
}

const productDefs: SeedProduct[] = [
  { name: 'Classic Cotton Tee', category: "Men's Tops", price: 24.99, compareAt: 34.99, sku: 'TEE-001', cost: 8, threshold: 8, variants: [
    { optionValues: { Size: 'S' }, inventory: 6, sku: 'TEE-001-S' },
    { optionValues: { Size: 'M' }, inventory: 2, sku: 'TEE-001-M' },
    { optionValues: { Size: 'L' }, inventory: 0, sku: 'TEE-001-L' }
  ] },
  { name: 'Slim Fit Chinos', category: "Men's Tops", price: 49.99, compareAt: 69.99, sku: 'CHN-002', cost: 18, threshold: 6, variants: [
    { optionValues: { Size: '30' }, inventory: 12, sku: 'CHN-002-30' },
    { optionValues: { Size: '32' }, inventory: 9, sku: 'CHN-002-32' },
    { optionValues: { Size: '34' }, inventory: 4, sku: 'CHN-002-34' }
  ] },
  { name: 'Floral Summer Dress', category: "Women's Dresses", price: 59.99, compareAt: 79.99, sku: 'DRS-003', cost: 22, threshold: 5, variants: [
    { optionValues: { Size: 'S' }, inventory: 3, sku: 'DRS-003-S' },
    { optionValues: { Size: 'M' }, inventory: 7, sku: 'DRS-003-M' },
    { optionValues: { Size: 'L' }, inventory: 1, sku: 'DRS-003-L' }
  ] },
  { name: 'Cashmere Scarf', category: 'Accessories', price: 79.99, compareAt: 99.99, sku: 'SCF-004', cost: 30, threshold: 5, variants: [
    { inventory: 14, sku: 'SCF-004' }
  ] },
  { name: 'Leather Belt', category: 'Accessories', price: 39.99, sku: 'BLT-005', cost: 14, threshold: 5, variants: [
    { optionValues: { Size: 'S' }, inventory: 10, sku: 'BLT-005-S' },
    { optionValues: { Size: 'M' }, inventory: 8, sku: 'BLT-005-M' },
    { optionValues: { Size: 'L' }, inventory: 6, sku: 'BLT-005-L' },
    { optionValues: { Size: 'XL' }, inventory: 0, sku: 'BLT-005-XL' }
  ] },
  { name: 'Running Sneakers', category: 'Sneakers', price: 89.99, compareAt: 119.99, sku: 'SNK-006', cost: 34, threshold: 4, variants: [
    { optionValues: { Size: 'US8' }, inventory: 5, sku: 'SNK-006-8' },
    { optionValues: { Size: 'US9' }, inventory: 2, sku: 'SNK-006-9' },
    { optionValues: { Size: 'US10' }, inventory: 0, sku: 'SNK-006-10' }
  ] },
  { name: 'Chelsea Boots', category: 'Footwear', price: 129.99, compareAt: 159.99, sku: 'BTS-007', cost: 52, threshold: 4, variants: [
    { optionValues: { Size: '40' }, inventory: 7, sku: 'BTS-007-40' },
    { optionValues: { Size: '41' }, inventory: 3, sku: 'BTS-007-41' },
    { optionValues: { Size: '42' }, inventory: 0, sku: 'BTS-007-42' },
    { optionValues: { Size: '43' }, inventory: 9, sku: 'BTS-007-43' }
  ] },
  { name: 'Wireless Headphones', category: 'Headphones', price: 149.99, compareAt: 199.99, sku: 'HDP-008', cost: 60, threshold: 5, variants: [
    { inventory: 18, sku: 'HDP-008' }
  ] },
  { name: 'Bluetooth Speaker', category: 'Electronics', price: 99.99, sku: 'SPK-009', cost: 38, threshold: 5, variants: [
    { inventory: 22, sku: 'SPK-009' }
  ] },
  { name: 'Smart Watch', category: 'Watches', price: 199.99, compareAt: 249.99, sku: 'WTC-010', cost: 85, threshold: 4, variants: [
    { inventory: 11, sku: 'WTC-010' }
  ] },
  { name: 'Ceramic Mug Set', category: 'Kitchen', price: 29.99, sku: 'MUG-011', cost: 9, threshold: 10, variants: [
    { inventory: 40, sku: 'MUG-011' }
  ] },
  { name: 'Cast Iron Skillet', category: 'Kitchen', price: 49.99, sku: 'SKL-012', cost: 21, threshold: 6, variants: [
    { inventory: 16, sku: 'SKL-012' }
  ] },
  { name: 'Scented Candle', category: 'Home', price: 19.99, sku: 'CND-013', cost: 6, threshold: 5, variants: [
    { inventory: 3, sku: 'CND-013' }
  ] },
  { name: 'Throw Blanket', category: 'Home', price: 44.99, compareAt: 59.99, sku: 'BLK-014', cost: 17, threshold: 6, variants: [
    { optionValues: { Color: 'Gray' }, inventory: 8, sku: 'BLK-014-GY' },
    { optionValues: { Color: 'Beige' }, inventory: 12, sku: 'BLK-014-BE' }
  ] },
  { name: 'Organic Face Serum', category: 'Beauty', price: 34.99, sku: 'SRM-015', cost: 11, threshold: 6, variants: [
    { inventory: 25, sku: 'SRM-015' }
  ] },
  { name: 'Vitamin C Cream', category: 'Beauty', price: 28.99, sku: 'CRM-016', cost: 9, threshold: 6, variants: [
    { inventory: 0, sku: 'CRM-016' }
  ] },
  { name: 'Yoga Mat', category: 'Yoga', price: 39.99, compareAt: 49.99, sku: 'YGM-017', cost: 12, threshold: 6, variants: [
    { inventory: 14, sku: 'YGM-017' }
  ] },
  { name: 'Dumbbell Set', category: 'Sports', price: 79.99, sku: 'DMB-018', cost: 28, threshold: 4, variants: [
    { optionValues: { Weight: '5kg' }, inventory: 6, sku: 'DMB-018-5' },
    { optionValues: { Weight: '10kg' }, inventory: 2, sku: 'DMB-018-10' }
  ] },
  { name: 'Bestselling Novel', category: 'Books', price: 15.99, sku: 'BOK-019', cost: 5, threshold: 10, variants: [
    { inventory: 50, sku: 'BOK-019' }
  ] },
  { name: 'Cookbook Collection', category: 'Books', price: 45.99, compareAt: 59.99, sku: 'BOK-020', cost: 20, threshold: 5, variants: [
    { inventory: 9, sku: 'BOK-020' }
  ] }
]

const FIRST = [
  'Ava', 'Liam', 'Maya', 'Noah', 'Zoe', 'Ethan', 'Lily', 'Lucas', 'Isla', 'Mason',
  'Ruby', 'Oliver', 'Emma', 'Henry', 'Chloe', 'Jack', 'Aria', 'Leo', 'Nora', 'Owen'
]
const LAST = [
  'Smith', 'Johnson', 'Brown', 'Lee', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Anderson',
  'Thomas', 'Moore', 'Martin', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Young', 'King'
]

const STATUS_WEIGHTS = [
  { status: 'delivered', w: 42 },
  { status: 'processing', w: 15 },
  { status: 'shipped', w: 15 },
  { status: 'pending', w: 12 },
  { status: 'cancelled', w: 10 },
  { status: 'refunded', w: 6 }
] as const

const pickStatus = () => {
  const total = STATUS_WEIGHTS.reduce((s, x) => s + x.w, 0)
  let r = rand() * total
  for (const { status, w } of STATUS_WEIGHTS) {
    r -= w
    if (r <= 0) return status
  }
  return 'delivered'
}

/* --------------------------------- seed --------------------------------- */

async function main() {
  console.log('🧹 Clearing existing data...')
  await connection.unsafe(`
    TRUNCATE TABLE user_outlets, roles, merchant_modules, outlets, visits, refunds,
    returns, order_items, orders, inventory_logs,
    product_variants, products, categories, customers, coupons, promotions,
    store_settings, payment_settings, shipping_settings, tax_settings, users, merchants
    RESTART IDENTITY CASCADE
  `)

  const passwordHash = await hash('password123', 10)

  /* merchant + staff */
  const [merchant] = await db
    .insert(merchants)
    .values({
      name: 'Acme Store',
      slug: 'acme-store',
      email: 'owner@acme.com',
      phone: '+1 555-0100',
      currency: 'USD',
      timezone: 'America/New_York',
      status: 'active'
    })
    .returning()

  await db
    .insert(users)
    .values([
      { merchantId: merchant.id, name: 'Alex Owner', email: 'owner@acme.com', passwordHash, role: 'owner', permissions: [] },
      { merchantId: merchant.id, name: 'Sam Admin', email: 'admin@acme.com', passwordHash, role: 'admin', permissions: [] },
      { merchantId: merchant.id, name: 'Jordan Staff', email: 'staff@acme.com', passwordHash, role: 'staff', permissions: ['products:write', 'orders:write', 'inventory:write'] },
      { merchantId: merchant.id, name: 'Riley Staff', email: 'riley@acme.com', passwordHash, role: 'staff', permissions: ['analytics:read'] }
    ])
    .returning()

  /* default outlet + modules + roles (Phase 1 foundation) */
  const [defaultOutlet] = await db
    .insert(outlets)
    .values({
      merchantId: merchant.id,
      name: 'Main Outlet',
      code: 'MAIN',
      address: { name: 'Acme Store', country: 'US', city: 'New York' },
      status: 'active'
    })
    .returning()

  const seedModules: ModuleId[] = [...DEFAULT_MODULES.commerce, 'restaurant', 'tables', 'kitchen']
  await db.insert(merchantModules).values(
    seedModules.map((module) => ({ merchantId: merchant.id, module, enabled: true }))
  )

  const seededRoles = await db
    .insert(roles)
    .values(
      DEFAULT_ROLES.map((r) => ({
        merchantId: merchant.id,
        name: r.name,
        isSystem: true,
        permissions: r.permissions as never,
        scope: r.scope as never,
        status: 'active'
      }))
    )
    .returning()

  // Admin (Sam) scoped to the default outlet; owner implicitly covers all.
  const [ownerUser] = await db.select().from(users).where(eq(users.email, 'owner@acme.com'))
  const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@acme.com'))
  await db.insert(userOutlets).values([
    { userId: ownerUser.id, outletId: defaultOutlet.id },
    { userId: adminUser.id, outletId: defaultOutlet.id }
  ])

  console.log(`   Seeded ${seededRoles.length} system roles, 1 outlet, ${DEFAULT_MODULES.commerce.length} modules`)

  /* dine-in floor */
  const [mainSection] = await db
    .insert(tableSections)
    .values({
      merchantId: merchant.id,
      outletId: defaultOutlet.id,
      name: 'Main Floor',
      sortOrder: 0,
      status: 'active'
    })
    .returning()
  const tableDefs = [
    { code: 'T01', name: 'Table 1', seats: 2 },
    { code: 'T02', name: 'Table 2', seats: 4 },
    { code: 'T03', name: 'Table 3', seats: 4 },
    { code: 'T04', name: 'Table 4', seats: 6 },
    { code: 'T05', name: 'Bar 1', seats: 2 },
    { code: 'T06', name: 'Bar 2', seats: 2 },
    { code: 'T07', name: 'Patio 1', seats: 4 },
    { code: 'T08', name: 'Patio 2', seats: 6 }
  ]
  for (const def of tableDefs) {
    await db.insert(tables).values({
      merchantId: merchant.id,
      outletId: defaultOutlet.id,
      sectionId: mainSection.id,
      name: def.name,
      code: def.code,
      seats: def.seats,
      qrToken: crypto.randomUUID().replace(/-/g, '') + Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex')
    })
  }
  console.log(`   Seeded ${tableDefs.length} tables in section "${mainSection.name}"`)

  /* kitchen stations */
  const stationDefs = [
    { name: 'Grill', prepSlaMin: 12 },
    { name: 'Fryer', prepSlaMin: 10 },
    { name: 'Drinks', prepSlaMin: 4 },
    { name: 'Dessert', prepSlaMin: 8 },
    { name: 'General', prepSlaMin: 10 }
  ]
  for (let i = 0; i < stationDefs.length; i++) {
    const existing = await db
      .select()
      .from(kitchenStations)
      .where(and(eq(kitchenStations.merchantId, merchant.id), eq(kitchenStations.name, stationDefs[i].name)))
    if (existing.length) continue
    await db.insert(kitchenStations).values({
      merchantId: merchant.id,
      name: stationDefs[i].name,
      outletId: defaultOutlet.id,
      prepSlaMin: stationDefs[i].prepSlaMin,
      sortOrder: i,
      status: 'active'
    })
  }
  console.log(`   Seeded ${stationDefs.length} kitchen stations`)

  /* categories */
  const catMap = new Map<string, string>()
  const allCatIds: string[] = []
  for (const def of categoryDefs) {
    const [parent] = await db
      .insert(categories)
      .values({
        merchantId: merchant.id,
        name: def.name,
        slug: def.name.toLowerCase().replace(/\s+/g, '-'),
        sortOrder: allCatIds.length,
        status: 'active'
      })
      .returning()
    catMap.set(def.name, parent.id)
    allCatIds.push(parent.id)
    for (const child of def.children ?? []) {
      const [c] = await db
        .insert(categories)
        .values({
          merchantId: merchant.id,
          parentId: parent.id,
          name: child,
          slug: child.toLowerCase().replace(/\s+/g, '-'),
          sortOrder: 0,
          status: 'active'
        })
        .returning()
      catMap.set(child, c.id)
      allCatIds.push(c.id)
    }
  }

  /* products + variants */
  const stockMap = new Map<string, number>()
  const variantCatalog: Array<{
    id: string
    productId: string
    name: string
    sku: string | null
    price: number
  }> = []

  for (const def of productDefs) {
    const categoryId = catMap.get(def.category)
    const [product] = await db
      .insert(products)
      .values({
        merchantId: merchant.id,
        categoryId: categoryId ?? null,
        sku: def.sku,
        name: def.name,
        slug: `${def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        description: `High-quality ${def.name.toLowerCase()} — a bestseller at Acme Store.`,
        price: def.price,
        compareAtPrice: def.compareAt ?? null,
        cost: def.cost ?? 0,
        trackInventory: true,
        lowStockThreshold: def.threshold ?? 5,
        status: 'active'
      })
      .returning()

    for (const v of def.variants) {
      // Headroom so the 120 seeded orders can't drain stock negative
      const inventory = v.inventory === 0 ? 0 : v.inventory * 4
      const [variant] = await db
        .insert(productVariants)
        .values({
          productId: product.id,
          optionValues: v.optionValues ?? {},
          sku: v.sku ?? def.sku,
          price: def.price,
          compareAtPrice: def.compareAt ?? null,
          inventory,
          image: null
        })
        .returning()
      stockMap.set(variant.id, inventory)
      variantCatalog.push({
        id: variant.id,
        productId: product.id,
        name: def.name,
        sku: variant.sku,
        price: variant.price
      })
    }
  }

  /* food menu (Phase 3) */
  const [extraGroup] = await db.insert(modifierGroups).values({
    merchantId: merchant.id, name: 'Add Ons', required: false,
    minSelections: 0, maxSelections: 3, sortOrder: 0, status: 'active'
  }).returning()
  const [sauceGroup] = await db.insert(modifierGroups).values({
    merchantId: merchant.id, name: 'Dipping Sauce', required: true,
    minSelections: 1, maxSelections: 1, sortOrder: 1, status: 'active'
  }).returning()
  await db.insert(modifiers).values([
    { merchantId: merchant.id, modifierGroupId: extraGroup.id, name: 'Extra Cheese', priceAdjustment: 1.5, available: true, sortOrder: 0, status: 'active' },
    { merchantId: merchant.id, modifierGroupId: extraGroup.id, name: 'Extra Sauce', priceAdjustment: 0.75, available: true, sortOrder: 1, status: 'active' },
    { merchantId: merchant.id, modifierGroupId: sauceGroup.id, name: 'Marinara', priceAdjustment: 0, available: true, sortOrder: 0, status: 'active' },
    { merchantId: merchant.id, modifierGroupId: sauceGroup.id, name: 'BBQ', priceAdjustment: 0, available: true, sortOrder: 1, status: 'active' }
  ])

  const menuProducts = await db.select().from(products).where(eq(products.merchantId, merchant.id)).orderBy(products.createdAt).limit(6)
  for (let i = 0; i < menuProducts.length; i++) {
    const p = menuProducts[i]
    const [menuItem] = await db.insert(menuItems).values({
      merchantId: merchant.id, productId: p.id, available: true,
      preparationTimeMin: 10 + (i % 3) * 5, kitchenStation: i % 2 === 0 ? 'Grill' : 'Fryer',
      dietaryTags: i % 2 === 0 ? ['vegan'] : [], allergens: i % 4 === 0 ? ['dairy'] : [],
      taxRate: 0, sortOrder: i, status: 'active', availability: []
    }).returning()
    await db.insert(menuItemModifiers).values({ merchantId: merchant.id, menuItemId: menuItem.id, modifierGroupId: extraGroup.id, sortOrder: 0 })
    await db.insert(menuItemOutlets).values({ merchantId: merchant.id, menuItemId: menuItem.id, outletId: defaultOutlet.id, available: true, priceAdjustment: 0 })
  }
  console.log(`   Seeded ${menuProducts.length} menu items, 2 modifier groups`)

  /* customers */
  const customerRows: Array<typeof customers.$inferInsert> = []
  for (let i = 0; i < 40; i++) {
    const first = pick(FIRST)
    const last = pick(LAST)
    const tags = new Set<string>()
    if (rand() < 0.25) tags.add('vip')
    if (rand() < 0.15) tags.add('wholesale')
    if (rand() < 0.4) tags.add('new')
    customerRows.push({
      merchantId: merchant.id,
      email: `${first}.${last}${int(1, 99)}@example.com`.toLowerCase(),
      firstName: first,
      lastName: last,
      phone: `+1 555-${int(100, 999)}${int(10, 99)}${int(10, 99)}`,
      tags: [...tags],
      totalSpent: 0,
      ordersCount: 0,
      lastOrderAt: null,
      createdAt: daysAgo(int(90, 360), int(8, 20))
    })
  }
  const insertedCustomers = await db.insert(customers).values(customerRows).returning()

  /* orders */
  const ORDER_COUNT = 120
  const orderIds: string[] = []
  const customerStats = new Map<string, { spent: number; count: number; last: Date }>()
  for (const c of insertedCustomers) customerStats.set(c.id, { spent: 0, count: 0, last: new Date(0) })

  let orderNumber = 1001
  for (let i = 0; i < ORDER_COUNT; i++) {
    const createdAt = daysAgo(int(0, 89), int(9, 21))
    const customer = pick(insertedCustomers)
    const status = pickStatus()
    const itemCount = int(1, 5)

    let subtotal = 0
    const chosen = Array.from({ length: itemCount }, () => {
      const inStock = variantCatalog.filter((v) => (stockMap.get(v.id) ?? 0) > 0)
      return pick(inStock.length > 0 ? inStock : variantCatalog)
    })
    const itemTotals = chosen
      .map((v) => {
        const available = stockMap.get(v.id) ?? 0
        const qty = Math.min(int(1, 3), Math.max(available, 0))
        if (qty === 0) return null
        const total = Number((v.price * qty).toFixed(2))
        subtotal = Number((subtotal + total).toFixed(2))
        return { ...v, qty, total }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
    if (itemTotals.length === 0) continue

    const discount = rand() < 0.18 ? Number((subtotal * (0.05 + rand() * 0.15)).toFixed(2)) : 0
    const taxable = Number((subtotal - discount).toFixed(2))
    const shipping = taxable >= 100 ? 0 : 10
    const tax = Number((taxable * 0.08).toFixed(2))
    const total = Number((taxable + shipping + tax).toFixed(2))

    const paymentStatus =
      status === 'cancelled' ? (rand() < 0.4 ? 'failed' : 'refunded') :
      status === 'pending' ? (rand() < 0.5 ? 'paid' : 'unpaid') :
      status === 'refunded' ? 'refunded' : 'paid'
    const fulfillmentStatus =
      status === 'delivered' || status === 'shipped' || status === 'refunded' ? 'fulfilled' : 'unfulfilled'

    const [order] = await db
      .insert(orders)
      .values({
        merchantId: merchant.id,
        customerId: customer.id,
        orderNumber: `#${orderNumber++}`,
        status,
        paymentStatus,
        fulfillmentStatus,
        subtotal,
        shippingTotal: shipping,
        discountTotal: discount,
        taxTotal: tax,
        total,
        currency: 'USD',
        shippingAddress: {
          name: `${customer.firstName} ${customer.lastName}`,
          line1: `${int(100, 9999)} Market St`,
          city: pick(['New York', 'Los Angeles', 'Chicago', 'Austin', 'Seattle', 'Miami']),
          state: 'US',
          postalCode: String(int(10000, 99999)),
          country: 'USA',
          phone: customer.phone ?? undefined
        },
        billingAddress: {
          name: `${customer.firstName} ${customer.lastName}`,
          line1: `${int(100, 9999)} Market St`,
          city: pick(['New York', 'Los Angeles', 'Chicago', 'Austin', 'Seattle', 'Miami']),
          state: 'US',
          postalCode: String(int(10000, 99999)),
          country: 'USA',
          phone: customer.phone ?? undefined
        },
        notes: rand() < 0.15 ? 'Gift order — please include a note.' : null,
        createdAt
      })
      .returning()
    orderIds.push(order.id)

    for (const item of itemTotals) {
      await db.insert(orderItems).values({
        orderId: order.id,
        productId: item.productId,
        variantId: item.id,
        name: item.name,
        sku: item.sku,
        price: item.price,
        quantity: item.qty,
        total: item.total
      })
    }

    if (status !== 'cancelled') {
      for (const item of itemTotals) {
        const before = stockMap.get(item.id) ?? 0
        const after = before - item.qty
        stockMap.set(item.id, after)
        await db.update(productVariants).set({ inventory: after }).where(eq(productVariants.id, item.id))
        await db.insert(inventoryLogs).values({
          merchantId: merchant.id,
          variantId: item.id,
          change: -item.qty,
          beforeValue: before,
          afterValue: after,
          reason: 'sale',
          reference: order.orderNumber
        })
      }
    }

    if (status === 'refunded') {
      for (const item of itemTotals) {
        const [ret] = await db
          .insert(returnsTable)
          .values({
            merchantId: merchant.id,
            orderId: order.id,
            quantity: item.qty,
            amount: item.total,
            reason: pick(['Item not as described', 'Changed my mind', 'Wrong size', 'Damaged in transit']),
            status: 'approved'
          })
          .returning()
        const before = stockMap.get(item.id) ?? 0
        const after = before + item.qty
        stockMap.set(item.id, after)
        await db.update(productVariants).set({ inventory: after }).where(eq(productVariants.id, item.id))
        await db.insert(inventoryLogs).values({
          merchantId: merchant.id,
          variantId: item.id,
          change: item.qty,
          beforeValue: before,
          afterValue: after,
          reason: 'return',
          reference: order.orderNumber
        })
        await db.insert(refunds).values({
          merchantId: merchant.id,
          orderId: order.id,
          returnId: ret.id,
          amount: item.total,
          method: 'original',
          status: 'completed'
        })
      }
    }

    // Mirror production semantics: only collected revenue counts toward
    // customer totals (pending+unpaid orders are excluded, like the API does).
    const countsTowardSpend =
      status !== 'cancelled' && !(status === 'pending' && paymentStatus === 'unpaid')
    if (countsTowardSpend) {
      const stats = customerStats.get(customer.id)!
      stats.spent = Number((stats.spent + total).toFixed(2))
      stats.count += 1
      if (createdAt > stats.last) stats.last = createdAt
    }
  }

  for (const [customerId, stats] of customerStats) {
    await db
      .update(customers)
      .set({
        totalSpent: stats.spent,
        ordersCount: stats.count,
        lastOrderAt: stats.count > 0 ? stats.last : null
      })
      .where(eq(customers.id, customerId))
  }

  /* coupons + promotions */
  await db.insert(coupons).values([
    { merchantId: merchant.id, code: 'SAVE10', type: 'percentage', value: 10, minSubtotal: 50, usageLimit: 500, usedCount: 132, status: 'active' },
    { merchantId: merchant.id, code: 'WELCOME15', type: 'percentage', value: 15, minSubtotal: 0, usageLimit: 1000, usedCount: 410, status: 'active' },
    { merchantId: merchant.id, code: 'FLAT20', type: 'fixed', value: 20, minSubtotal: 100, usageLimit: 200, usedCount: 87, status: 'active' },
    { merchantId: merchant.id, code: 'FREESHIP', type: 'free_shipping', value: 0, minSubtotal: 75, usageLimit: 300, usedCount: 203, status: 'active' },
    { merchantId: merchant.id, code: 'SUMMER25', type: 'percentage', value: 25, minSubtotal: 120, usageLimit: 50, usedCount: 50, status: 'disabled', endsAt: daysAgo(10) }
  ])

  await db.insert(promotions).values([
    // Demo promotions are deliberately NOT active right now — an auto-applied
    // promotion would silently change every seeded checkout total. Summer Sale
    // has ended, Electronics Week is disabled, and Buy2Get1 starts next month.
    { merchantId: merchant.id, name: 'Summer Sale', type: 'discount_on_products', discountPercent: 20, appliesTo: { scope: 'all' }, status: 'active', startsAt: daysAgo(30), endsAt: daysAgo(14) },
    { merchantId: merchant.id, name: 'Buy 2 Tees Get 1 Half Price', type: 'buy_x_get_y', discountPercent: 50, appliesTo: { scope: 'products', productIds: [] }, status: 'active', startsAt: daysAgo(-15), endsAt: null },
    { merchantId: merchant.id, name: 'Electronics Week', type: 'discount_on_products', discountPercent: 15, appliesTo: { scope: 'category', categoryId: catMap.get('Electronics'), productIds: [] }, status: 'disabled', startsAt: daysAgo(7), endsAt: daysAgo(-7) }
  ])

  /* settings */
  await db.insert(storeSettings).values({
    merchantId: merchant.id,
    name: 'Acme Store',
    logo: null,
    address: { line1: '100 Market St', city: 'New York', state: 'NY', postalCode: '10001', country: 'USA' },
    currency: 'USD',
    timezone: 'America/New_York',
    announcement: 'Free shipping on orders over $100'
  })
  await db.insert(paymentSettings).values({
    merchantId: merchant.id,
    methods: [
      { id: 'card', label: 'Credit / Debit Card', enabled: true },
      { id: 'cod', label: 'Cash on Delivery', enabled: true },
      { id: 'paypal', label: 'PayPal', enabled: false }
    ],
    currency: 'USD'
  })
  await db.insert(shippingSettings).values({
    merchantId: merchant.id,
    zones: [
      { name: 'United States', countries: ['US'], rate: 10, freeAbove: 100 },
      { name: 'Canada', countries: ['CA'], rate: 18, freeAbove: 150 },
      { name: 'Europe', countries: ['GB', 'DE', 'FR'], rate: 25, freeAbove: 200 },
      // Explicit wildcard default — an empty country list applies everywhere.
      // Without it, destinations outside the listed zones are rejected at
      // checkout instead of silently receiving the first zone's rate.
      { name: 'Rest of world', countries: [], rate: 35 }
    ],
    freeShippingThreshold: 100
  })
  await db.insert(taxSettings).values({
    merchantId: merchant.id,
    autoCalculate: true,
    rates: [
      { region: 'US-NY', rate: 8.875 },
      { region: 'US-CA', rate: 7.25 },
      { region: 'GB', rate: 20 }
    ]
  })

  /* visits */
  const channels = ['organic', 'paid', 'social', 'email', 'direct'] as const
  const visitRows: typeof visits.$inferInsert[] = []
  for (let day = 0; day < 90; day++) {
    for (const channel of channels) {
      const views = int(40, 500)
      const cartAdds = Math.floor(views * (0.08 + rand() * 0.22))
      const checkouts = Math.floor(cartAdds * (0.3 + rand() * 0.35))
      const paid = Math.floor(checkouts * (0.5 + rand() * 0.35))
      visitRows.push({
        merchantId: merchant.id,
        date: daysAgo(day, 12),
        channel,
        views,
        cartAdds,
        checkouts,
        paid
      })
    }
  }
  await db.insert(visits).values(visitRows)

  console.log('✅ Seed complete')
  console.log('───────────────────────────────────────────')
  console.log('   Store:        Acme Store')
  console.log('   Merchant:     acme-store')
  console.log('   Admin login:  admin@acme.com')
  console.log('   Password:     password123')
  console.log('   Products:     20')
  console.log(`   Orders:       ${orderIds.length}`)
  console.log('   Customers:    40')
  console.log('───────────────────────────────────────────')

  await connection.end()
}

main().catch((e) => {
  console.error('❌ Seed failed:', e)
  process.exit(1)
})
