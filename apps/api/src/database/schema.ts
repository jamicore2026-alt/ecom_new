import {
  pgTable,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import type { Address, Permission } from '../shared/types'

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' })

const id = (name: string) => varchar(name, { length: 30 }).$defaultFn(() => createId())

const merchantIdRef = () =>
  varchar('merchant_id', { length: 30 })
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' })

/* ---------------------------------- core ---------------------------------- */

export const merchants = pgTable('merchants', {
  id: id('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

export const users = pgTable(
  'users',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull().default('staff'),
    permissions: jsonb('permissions').$type<Permission[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('users_merchant_email_idx').on(t.merchantId, t.email)]
)

/* --------------------------------- catalog -------------------------------- */

export const categories = pgTable(
  'categories',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    parentId: varchar('parent_id', { length: 30 }).references((): any => categories.id, {
      onDelete: 'set null'
    }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    image: varchar('image', { length: 1024 }),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('categories_merchant_slug_idx').on(t.merchantId, t.slug)]
)

export const products = pgTable(
  'products',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    categoryId: varchar('category_id', { length: 30 }).references(() => categories.id, {
      onDelete: 'set null'
    }),
    sku: varchar('sku', { length: 100 }),
    barcode: varchar('barcode', { length: 100 }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    price: money('price').notNull().default(0),
    compareAtPrice: money('compare_at_price'),
    cost: money('cost').notNull().default(0),
    trackInventory: boolean('track_inventory').notNull().default(false),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('products_merchant_sku_idx').on(t.merchantId, t.sku),
    index('products_merchant_idx').on(t.merchantId)
  ]
)

export const productVariants = pgTable(
  'product_variants',
  {
    id: id('id').primaryKey(),
    productId: varchar('product_id', { length: 30 })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    optionValues: jsonb('option_values')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    sku: varchar('sku', { length: 100 }),
    price: money('price').notNull().default(0),
    compareAtPrice: money('compare_at_price'),
    inventory: integer('inventory').notNull().default(0),
    image: varchar('image', { length: 1024 }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('product_variants_product_idx').on(t.productId)]
)

export const inventoryLogs = pgTable(
  'inventory_logs',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    variantId: varchar('variant_id', { length: 30 })
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    change: integer('change').notNull(),
    beforeValue: integer('before_value').notNull(),
    afterValue: integer('after_value').notNull(),
    reason: varchar('reason', { length: 20 }).notNull(),
    reference: varchar('reference', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('inventory_logs_variant_idx').on(t.variantId)]
)

/* -------------------------------- customers ------------------------------- */

export const customers = pgTable(
  'customers',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    email: varchar('email', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 255 }),
    lastName: varchar('last_name', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    totalSpent: money('total_spent').notNull().default(0),
    ordersCount: integer('orders_count').notNull().default(0),
    lastOrderAt: timestamp('last_order_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('customers_merchant_email_idx').on(t.merchantId, t.email)]
)

/* --------------------------------- orders --------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 }).references(() => customers.id, {
      onDelete: 'set null'
    }),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    paymentStatus: varchar('payment_status', { length: 30 }).notNull().default('unpaid'),
    fulfillmentStatus: varchar('fulfillment_status', { length: 20 })
      .notNull()
      .default('unfulfilled'),
    subtotal: money('subtotal').notNull().default(0),
    shippingTotal: money('shipping_total').notNull().default(0),
    discountTotal: money('discount_total').notNull().default(0),
    taxTotal: money('tax_total').notNull().default(0),
    total: money('total').notNull().default(0),
    currency: varchar('currency', { length: 10 }).notNull().default('USD'),
    shippingAddress: jsonb('shipping_address').$type<Address>(),
    billingAddress: jsonb('billing_address').$type<Address>(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('orders_merchant_number_idx').on(t.merchantId, t.orderNumber),
    index('orders_merchant_status_idx').on(t.merchantId, t.status)
  ]
)

export const orderItems = pgTable(
  'order_items',
  {
    id: id('id').primaryKey(),
    orderId: varchar('order_id', { length: 30 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: varchar('product_id', { length: 30 }).references(() => products.id, {
      onDelete: 'set null'
    }),
    variantId: varchar('variant_id', { length: 30 }).references(() => productVariants.id, {
      onDelete: 'set null'
    }),
    name: varchar('name', { length: 255 }).notNull(),
    sku: varchar('sku', { length: 100 }),
    price: money('price').notNull().default(0),
    quantity: integer('quantity').notNull().default(1),
    total: money('total').notNull().default(0)
  },
  (t) => [index('order_items_order_idx').on(t.orderId)]
)

export const returnsTable = pgTable(
  'returns',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    orderId: varchar('order_id', { length: 30 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderItemId: varchar('order_item_id', { length: 30 }).references(() => orderItems.id, {
      onDelete: 'set null'
    }),
    quantity: integer('quantity').notNull().default(1),
    amount: money('amount').notNull().default(0),
    reason: text('reason'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('returns_merchant_idx').on(t.merchantId, t.orderId)]
)

export const refunds = pgTable(
  'refunds',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    orderId: varchar('order_id', { length: 30 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    returnId: varchar('return_id', { length: 30 }).references(() => returnsTable.id, {
      onDelete: 'set null'
    }),
    amount: money('amount').notNull().default(0),
    method: varchar('method', { length: 30 }).notNull().default('original'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('refunds_merchant_idx').on(t.merchantId, t.orderId)]
)

/* -------------------------------- discounts ------------------------------- */

export const coupons = pgTable(
  'coupons',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    code: varchar('code', { length: 100 }).notNull(),
    type: varchar('type', { length: 30 }).notNull().default('percentage'),
    value: money('value').notNull().default(0),
    minSubtotal: money('min_subtotal').notNull().default(0),
    usageLimit: integer('usage_limit'),
    usedCount: integer('used_count').notNull().default(0),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('coupons_merchant_code_idx').on(t.merchantId, t.code)]
)

export const promotions = pgTable(
  'promotions',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 30 }).notNull().default('discount_on_products'),
    discountPercent: money('discount_percent').notNull().default(0),
    appliesTo: jsonb('applies_to')
      .$type<{ scope: 'all' | 'products' | 'category'; productIds?: string[]; categoryId?: string }>()
      .notNull()
      .default({ scope: 'all' }),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('promotions_merchant_idx').on(t.merchantId)]
)

/* -------------------------------- settings -------------------------------- */

export const storeSettings = pgTable('store_settings', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  logo: varchar('logo', { length: 1024 }),
  address: jsonb('address').$type<Address>().notNull().default({}),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
  announcement: text('announcement').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const paymentSettings = pgTable('payment_settings', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  methods: jsonb('methods')
    .$type<Array<{ id: string; label: string; enabled: boolean }>>()
    .notNull()
    .default([]),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const shippingSettings = pgTable('shipping_settings', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  zones: jsonb('zones')
    .$type<
      Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>
    >()
    .notNull()
    .default([]),
  freeShippingThreshold: money('free_shipping_threshold').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const taxSettings = pgTable('tax_settings', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  autoCalculate: boolean('auto_calculate').notNull().default(true),
  rates: jsonb('rates')
    .$type<Array<{ region: string; rate: number }>>()
    .notNull()
    .default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

/* --------------------------------- visits --------------------------------- */

export const visits = pgTable(
  'visits',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    date: timestamp('date').notNull(),
    channel: varchar('channel', { length: 20 }).notNull(),
    views: integer('views').notNull().default(0),
    cartAdds: integer('cart_adds').notNull().default(0),
    checkouts: integer('checkouts').notNull().default(0),
    paid: integer('paid').notNull().default(0)
  },
  (t) => [uniqueIndex('visits_merchant_date_channel_idx').on(t.merchantId, t.date, t.channel)]
)

/* ---------------------------------- tokens --------------------------------- */

export const tokenBlacklist = pgTable(
  'token_blacklist',
  {
    id: id('id').primaryKey(),
    userId: varchar('user_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jti: varchar('jti', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('token_blacklist_jti_idx').on(t.jti), index('token_blacklist_user_idx').on(t.userId)]
)

/* --------------------------------- exports -------------------------------- */

export const table = {
  merchants,
  users,
  categories,
  products,
  productVariants,
  inventoryLogs,
  customers,
  orders,
  orderItems,
  returnsTable,
  refunds,
  coupons,
  promotions,
  storeSettings,
  paymentSettings,
  shippingSettings,
  taxSettings,
  visits,
  tokenBlacklist
} as const

export type Table = typeof table

export type Merchant = typeof merchants.$inferSelect
export type NewMerchant = typeof merchants.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type ProductVariant = typeof productVariants.$inferSelect
export type NewProductVariant = typeof productVariants.$inferInsert
export type InventoryLog = typeof inventoryLogs.$inferSelect
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type OrderItem = typeof orderItems.$inferSelect
export type NewOrderItem = typeof orderItems.$inferInsert
export type ReturnRecord = typeof returnsTable.$inferSelect
export type NewReturn = typeof returnsTable.$inferInsert
export type Refund = typeof refunds.$inferSelect
export type NewRefund = typeof refunds.$inferInsert
export type Coupon = typeof coupons.$inferSelect
export type NewCoupon = typeof coupons.$inferInsert
export type Promotion = typeof promotions.$inferSelect
export type NewPromotion = typeof promotions.$inferInsert
export type StoreSettings = typeof storeSettings.$inferSelect
export type PaymentSettings = typeof paymentSettings.$inferSelect
export type ShippingSettings = typeof shippingSettings.$inferSelect
export type TaxSettings = typeof taxSettings.$inferSelect
export type Visit = typeof visits.$inferSelect
export type TokenBlacklist = typeof tokenBlacklist.$inferSelect
export type NewTokenBlacklist = typeof tokenBlacklist.$inferInsert
