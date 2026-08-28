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
  index,
  primaryKey,
  customType
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { Address, ModuleId, OutletStatus, Permission, Scope } from '../shared/types'

// scale 3 supports GCC currencies with 3 decimals (KWD/BHD/OMR)
const money = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' })

const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => 'tsvector' })

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

/* --------------------------------- outlets -------------------------------- */

export const outlets = pgTable(
  'outlets',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    address: jsonb('address').$type<Address>().notNull().default({}),
    status: varchar('status', { length: 20 }).$type<OutletStatus>().notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('outlets_merchant_code_idx').on(t.merchantId, t.code),
    index('outlets_merchant_idx').on(t.merchantId)
  ]
)

/* --------------------------- merchant modules --------------------------- */

export const merchantModules = pgTable(
  'merchant_modules',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    module: varchar('module', { length: 30 }).$type<ModuleId>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('merchant_modules_merchant_module_idx').on(t.merchantId, t.module)]
)

/* -------------------------------- roles -------------------------------- */

export const roles = pgTable(
  'roles',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 50 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    permissions: jsonb('permissions').$type<Permission[]>().notNull().default([]),
    scope: varchar('scope', { length: 20 }).$type<Scope>().notNull().default('MERCHANT'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [uniqueIndex('roles_merchant_name_idx').on(t.merchantId, t.name)]
)

/* ----------------------------- user outlets ----------------------------- */

export const userOutlets = pgTable(
  'user_outlets',
  {
    id: id('id').primaryKey(),
    userId: varchar('user_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    outletId: varchar('outlet_id', { length: 30 })
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('user_outlets_user_outlet_idx').on(t.userId, t.outletId),
    index('user_outlets_outlet_idx').on(t.outletId)
  ]
)

/* ------------------------------- food menu ------------------------------- */

/** Food-specific metadata layered onto an existing catalog product/variant. */
export const menuItems = pgTable(
  'menu_items',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    productId: varchar('product_id', { length: 30 })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    available: boolean('available').notNull().default(true),
    preparationTimeMin: integer('preparation_time_min').notNull().default(0),
    kitchenStation: varchar('kitchen_station', { length: 100 }),
    dietaryTags: jsonb('dietary_tags').$type<string[]>().notNull().default([]),
    allergens: jsonb('allergens').$type<string[]>().notNull().default([]),
    taxRate: numeric('tax_rate', { precision: 6, scale: 3, mode: 'number' }).notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    /** Time-based availability: [{ days: number[] (0=Sun..6=Sat), start: "09:00", end: "22:00" }]. Empty = always. */
    availability: jsonb('availability').notNull().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('menu_items_merchant_product_idx').on(t.merchantId, t.productId),
    index('menu_items_merchant_idx').on(t.merchantId)
  ]
)

export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 120 }).notNull(),
    required: boolean('required').notNull().default(false),
    minSelections: integer('min_selections').notNull().default(0),
    maxSelections: integer('max_selections').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [index('modifier_groups_merchant_idx').on(t.merchantId)]
)

export const modifiers = pgTable(
  'modifiers',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    modifierGroupId: varchar('modifier_group_id', { length: 30 })
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    priceAdjustment: money('price_adjustment').notNull().default(0),
    available: boolean('available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    index('modifiers_group_idx').on(t.modifierGroupId),
    index('modifiers_merchant_idx').on(t.merchantId)
  ]
)

/** Which modifier groups are offered on which menu item. */
export const menuItemModifiers = pgTable(
  'menu_item_modifiers',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    menuItemId: varchar('menu_item_id', { length: 30 })
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    modifierGroupId: varchar('modifier_group_id', { length: 30 })
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('menu_item_modifiers_item_group_idx').on(t.menuItemId, t.modifierGroupId)
  ]
)

/** Per-outlet availability + optional price adjustment for a menu item. */
export const menuItemOutlets = pgTable(
  'menu_item_outlets',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    menuItemId: varchar('menu_item_id', { length: 30 })
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    outletId: varchar('outlet_id', { length: 30 })
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    available: boolean('available').notNull().default(true),
    priceAdjustment: money('price_adjustment').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('menu_item_outlets_item_outlet_idx').on(t.menuItemId, t.outletId)
  ]
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
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(name, '') || ' ' || coalesce(sku, '') || ' ' || coalesce(description, ''))`
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('products_merchant_sku_idx').on(t.merchantId, t.sku),
    // DB-level backstop for app-level uniqueSlug() — tenant-scoped slug
    // collisions become impossible even under racing inserts.
    uniqueIndex('products_merchant_slug_idx').on(t.merchantId, t.slug),
    index('products_merchant_idx').on(t.merchantId),
    index('products_search_idx').using('gin', t.searchVector)
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
    // clock_timestamp() (volatile) is evaluated per row — batch-inserted
    // variants get distinct, insertion-ordered timestamps. now() would stamp
    // every row in a statement identically, making ORDER BY created_at ties
    // nondeterministic across databases.
    createdAt: timestamp('created_at')
      .default(sql`clock_timestamp()`)
      .notNull()
  },
  (t) => [index('product_variants_product_idx').on(t.productId)]
)

export const productImages = pgTable(
  'product_images',
  {
    id: id('id').primaryKey(),
    productId: varchar('product_id', { length: 30 })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: varchar('url', { length: 1024 }).notNull(),
    altText: varchar('alt_text', { length: 255 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('product_images_product_idx').on(t.productId)]
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
    passwordHash: varchar('password_hash', { length: 255 }),
    firstName: varchar('first_name', { length: 255 }),
    lastName: varchar('last_name', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    totalSpent: money('total_spent').notNull().default(0),
    ordersCount: integer('orders_count').notNull().default(0),
    lastOrderAt: timestamp('last_order_at'),
    /** Bumped on password change — invalidates previously issued shopper JWTs. */
    tokenVersion: integer('token_version').notNull().default(0),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('customers_merchant_email_idx').on(t.merchantId, t.email)]
)

/**
 * Staff-safe customer projection — never select the raw table for API responses;
 * passwordHash must not leave the database.
 */
export const publicCustomerColumns = {
  id: customers.id,
  merchantId: customers.merchantId,
  email: customers.email,
  firstName: customers.firstName,
  lastName: customers.lastName,
  phone: customers.phone,
  tags: customers.tags,
  totalSpent: customers.totalSpent,
  ordersCount: customers.ordersCount,
  lastOrderAt: customers.lastOrderAt,
  emailVerified: customers.emailVerified,
  emailVerifiedAt: customers.emailVerifiedAt,
  createdAt: customers.createdAt
}

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
    paymentMethod: varchar('payment_method', { length: 50 }),
    paymentProvider: varchar('payment_provider', { length: 30 }),
    /** Coupon applied at purchase time — lets cancellations restore the usage quota. */
    couponCode: varchar('coupon_code', { length: 100 }),
    promotionId: varchar('promotion_id', { length: 30 }).references(() => promotions.id, {
      onDelete: 'set null'
    }),
    /** Marketing attribution captured at checkout (funnel `paid` metric). */
    attributionChannel: varchar('attribution_channel', { length: 20 }),
    expiresAt: timestamp('expires_at'),
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

export const reviews = pgTable(
  'reviews',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    productId: varchar('product_id', { length: 30 })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    customerId: varchar('customer_id', { length: 30 }).references(() => customers.id, {
      onDelete: 'set null'
    }),
    authorName: varchar('author_name', { length: 255 }).notNull(),
    rating: integer('rating').notNull(),
    title: varchar('title', { length: 255 }),
    body: text('body'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('reviews_product_customer_idx').on(t.productId, t.customerId),
    index('reviews_merchant_status_idx').on(t.merchantId, t.status)
  ]
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    actorUserId: varchar('actor_user_id', { length: 30 }).references(() => users.id, {
      onDelete: 'set null'
    }),
    actorName: varchar('actor_name', { length: 255 }),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: varchar('entity_id', { length: 30 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('audit_logs_merchant_created_idx').on(t.merchantId, t.createdAt),
    index('audit_logs_merchant_action_idx').on(t.merchantId, t.action),
    index('audit_logs_entity_idx').on(t.merchantId, t.entityType, t.entityId)
  ]
)

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    productId: varchar('product_id', { length: 30 })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('wishlist_customer_product_idx').on(t.customerId, t.productId),
    index('wishlist_merchant_idx').on(t.merchantId)
  ]
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
    providerRef: varchar('provider_ref', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // Idempotent retries: the same key can never create a second external refund.
    idempotencyKey: varchar('idempotency_key', { length: 80 }),
    attemptCount: integer('attempt_count').notNull().default(1),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('refunds_merchant_idx').on(t.merchantId, t.orderId),
    index('refunds_idempotency_idx').on(t.idempotencyKey)
  ]
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
    // buy_x_get_y semantics: every (buyQty+getQty)-th unit gets discountPercent off.
    buyQty: integer('buy_qty').notNull().default(2),
    getQty: integer('get_qty').notNull().default(1),
    appliesTo: jsonb('applies_to')
      .$type<{ scope: 'all' | 'products' | 'category'; productIds?: string[]; categoryId?: string }>()
      .notNull()
      .default({ scope: 'all' }),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    usageLimit: integer('usage_limit'),
    usedCount: integer('used_count').notNull().default(0),
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

/* ------------------------------ payments (BYOK) ----------------------------- */

export const PAYMENT_TXN_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded'] as const
export type PaymentTxnStatus = (typeof PAYMENT_TXN_STATUSES)[number]

export const paymentProviderConfigs = pgTable(
  'payment_provider_configs',
  {
    merchantId: varchar('merchant_id', { length: 30 })
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 30 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    mode: varchar('mode', { length: 10 }).notNull().default('test'),
    country: varchar('country', { length: 5 }),
    // AES-256-GCM ciphertext of the credential map ({ key: value }) — never stored in plaintext
    credentials: text('credentials').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [primaryKey({ columns: [t.merchantId, t.provider] })]
)

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    orderId: varchar('order_id', { length: 30 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 30 }).notNull(),
    providerRef: varchar('provider_ref', { length: 255 }),
    status: varchar('status', { length: 20 }).$type<PaymentTxnStatus>().notNull().default('pending'),
    amount: money('amount').notNull().default(0),
    currency: varchar('currency', { length: 10 }).notNull().default('USD'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    index('payment_transactions_order_idx').on(t.orderId),
    index('payment_transactions_ref_idx').on(t.providerRef)
  ]
)

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id('id').primaryKey(),
    provider: varchar('provider', { length: 30 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    payload: jsonb('payload'),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('webhook_events_provider_event_idx').on(t.provider, t.eventId)]
)

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

/* ------------------------------- notifications ----------------------------- */

export const notificationSettings = pgTable('notification_settings', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  fromName: varchar('from_name', { length: 255 }),
  fromEmail: varchar('from_email', { length: 255 }),
  /** Per-template opt-outs; missing key = enabled */
  templates: jsonb('templates').$type<Record<string, boolean>>().notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const EMAIL_TEMPLATE_IDS = ['order_placed', 'order_paid', 'refund_processed'] as const
export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number]

export const emailLogs = pgTable(
  'email_logs',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    orderId: varchar('order_id', { length: 30 }).references(() => orders.id, {
      onDelete: 'set null'
    }),
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    template: varchar('template', { length: 50 }).$type<EmailTemplateId>().notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    providerRef: varchar('provider_ref', { length: 255 }),
    error: text('error'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('email_logs_merchant_idx').on(t.merchantId, t.createdAt),
    index('email_logs_order_idx').on(t.orderId)
  ]
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


/* ----------------------------- outbound webhooks ---------------------------- */

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    secret: varchar('secret', { length: 255 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
    lastDeliveryAt: timestamp('last_delivery_at')
  },
  (t) => [index('webhook_endpoints_merchant_idx').on(t.merchantId)]
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    endpointId: varchar('endpoint_id', { length: 30 })
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: varchar('event', { length: 50 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    signature: varchar('signature', { length: 255 }),
    attempts: integer('attempts').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('webhook_deliveries_merchant_status_idx').on(t.merchantId, t.status),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId),
    index('webhook_deliveries_retry_idx').on(t.nextRetryAt)
  ]
)

/* ----------------------------- background jobs ----------------------------- */

export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    type: varchar('type', { length: 50 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at'),
    lockedUntil: timestamp('locked_until'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    index('background_jobs_merchant_type_idx').on(t.merchantId, t.type),
    index('background_jobs_status_retry_idx').on(t.status, t.nextRetryAt),
    index('background_jobs_locked_idx').on(t.lockedUntil)
  ]
)

/* --------------------------- fulfillment / shipment --------------------------- */

export const fulfillments = pgTable(
  'fulfillments',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    orderId: varchar('order_id', { length: 30 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('unfulfilled'),
    carrier: varchar('carrier', { length: 100 }),
    courierProvider: varchar('courier_provider', { length: 50 }),
    trackingNumber: varchar('tracking_number', { length: 255 }),
    trackingUrl: varchar('tracking_url', { length: 1024 }),
    labelUrl: varchar('label_url', { length: 1024 }),
    shippedAt: timestamp('shipped_at'),
    deliveredAt: timestamp('delivered_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    index('fulfillments_merchant_order_idx').on(t.merchantId, t.orderId),
    index('fulfillments_status_idx').on(t.status)
  ]
)

/* --------------------------- customer addresses --------------------------- */

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    addressType: varchar('address_type', { length: 20 }).notNull().default('both'),
    label: varchar('label', { length: 100 }).notNull().default('default'),
    name: varchar('name', { length: 255 }),
    company: varchar('company', { length: 255 }),
    line1: varchar('line1', { length: 255 }).notNull().default(''),
    line2: varchar('line2', { length: 255 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    country: varchar('country', { length: 3 }).notNull().default(''),
    phone: varchar('phone', { length: 50 }),
    isDefaultShipping: boolean('is_default_shipping').notNull().default(false),
    isDefaultBilling: boolean('is_default_billing').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    index('customer_addresses_merchant_customer_idx').on(t.merchantId, t.customerId),
    index('customer_addresses_customer_idx').on(t.customerId)
  ]
)

/* --------------------------- abandoned carts --------------------------- */

export const carts = pgTable(
  'carts',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 }).references(() => customers.id, {
      onDelete: 'set null'
    }),
    items: jsonb('items').notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    recoveryCode: varchar('recovery_code', { length: 100 }),
    abandonedAt: timestamp('abandoned_at'),
    recoveredOrderId: varchar('recovered_order_id', { length: 30 }).references(() => orders.id, {
      onDelete: 'set null'
    }),
    recoverySentAt: timestamp('recovery_sent_at'),
    lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    index('carts_merchant_status_idx').on(t.merchantId, t.status),
    index('carts_customer_idx').on(t.customerId),
    index('carts_abandoned_idx').on(t.abandonedAt)
  ]
)

/* ------------------------------- invoices ------------------------------- */

export const invoices = pgTable(
  'invoices',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    orderId: varchar('order_id', { length: 30 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    invoiceType: varchar('invoice_type', { length: 20 }).notNull().default('invoice'),
    status: varchar('status', { length: 20 }).notNull().default('issued'),
    subtotal: money('subtotal').notNull().default(0),
    discountTotal: money('discount_total').notNull().default(0),
    shippingTotal: money('shipping_total').notNull().default(0),
    taxTotal: money('tax_total').notNull().default(0),
    total: money('total').notNull().default(0),
    gstin: varchar('gstin', { length: 50 }),
    hsnCodes: jsonb('hsn_codes').notNull().default({}),
    billingAddress: jsonb('billing_address').notNull().default({}),
    shippingAddress: jsonb('shipping_address').notNull().default({}),
    pdfUrl: varchar('pdf_url', { length: 1024 }),
    invoiceDate: timestamp('invoice_date').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('invoices_merchant_number_idx').on(t.merchantId, t.invoiceNumber),
    index('invoices_merchant_idx').on(t.merchantId),
    index('invoices_order_idx').on(t.orderId)
  ]
)

/* ------------------------------ warehouses ------------------------------ */

export const warehouses = pgTable(
  'warehouses',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    address: jsonb('address').$type<Address>().notNull().default({}),
    isDefault: boolean('is_default').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('warehouses_merchant_code_idx').on(t.merchantId, t.code),
    index('warehouses_merchant_idx').on(t.merchantId)
  ]
)

export const warehouseInventory = pgTable(
  'warehouse_inventory',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    warehouseId: varchar('warehouse_id', { length: 30 })
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    variantId: varchar('variant_id', { length: 30 })
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [
    uniqueIndex('warehouse_inventory_warehouse_variant_idx').on(t.warehouseId, t.variantId),
    index('warehouse_inventory_merchant_idx').on(t.merchantId)
  ]
)

export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    fromWarehouseId: varchar('from_warehouse_id', { length: 30 })
      .notNull()
      .references(() => warehouses.id, { onDelete: 'set null' }),
    toWarehouseId: varchar('to_warehouse_id', { length: 30 })
      .notNull()
      .references(() => warehouses.id, { onDelete: 'set null' }),
    variantId: varchar('variant_id', { length: 30 })
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at')
  },
  (t) => [index('stock_transfers_merchant_idx').on(t.merchantId)]
)

/* --------------------------- customer segments --------------------------- */

export const customerSegments = pgTable(
  'customer_segments',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    definition: jsonb('definition').notNull().default({}),
    customerCount: integer('customer_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [index('customer_segments_merchant_idx').on(t.merchantId)]
)

/* ------------------------------ loyalty ------------------------------ */

export const loyaltyAccounts = pgTable(
  'loyalty_accounts',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(0),
    lifetimePoints: integer('lifetime_points').notNull().default(0),
    tier: varchar('tier', { length: 30 }).notNull().default('standard'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [uniqueIndex('loyalty_accounts_merchant_customer_idx').on(t.merchantId, t.customerId)]
)

export const loyaltyLedger = pgTable(
  'loyalty_ledger',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull(),
    points: integer('points').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reference: varchar('reference', { length: 255 }),
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    index('loyalty_ledger_merchant_customer_idx').on(t.merchantId, t.customerId),
    index('loyalty_ledger_customer_idx').on(t.customerId)
  ]
)

/* ------------------------------ affiliates ------------------------------ */

export const affiliates = pgTable(
  'affiliates',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    referralCode: varchar('referral_code', { length: 50 }).notNull(),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).notNull().default(sql`0`),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [uniqueIndex('affiliates_merchant_code_idx').on(t.merchantId, t.referralCode)]
)

export const referrals = pgTable(
  'referrals',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    affiliateId: varchar('affiliate_id', { length: 30 })
      .notNull()
      .references(() => affiliates.id, { onDelete: 'cascade' }),
    customerId: varchar('customer_id', { length: 30 }).references(() => customers.id, {
      onDelete: 'set null'
    }),
    orderId: varchar('order_id', { length: 30 }).references(() => orders.id, {
      onDelete: 'set null'
    }),
    conversionStatus: varchar('conversion_status', { length: 20 }).notNull().default('clicked'),
    commissionAmount: money('commission_amount').notNull().default(0),
    commissionStatus: varchar('commission_status', { length: 20 }).notNull().default('pending'),
    source: varchar('source', { length: 20 }).notNull().default('click'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('referrals_merchant_affiliate_idx').on(t.merchantId, t.affiliateId)]
)

/* ------------------------------- content pages ------------------------------- */

export const contentPages = pgTable(
  'content_pages',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    content: text('content').notNull().default(''),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    metaTitle: varchar('meta_title', { length: 255 }),
    metaDescription: varchar('meta_description', { length: 500 }),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [uniqueIndex('content_pages_merchant_slug_idx').on(t.merchantId, t.slug)]
)

/* ------------------------------ API keys ------------------------------ */

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
    secretHash: varchar('secret_hash', { length: 255 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('api_keys_merchant_idx').on(t.merchantId)]
)

/* --------------------------- password reset / verification --------------------------- */

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('password_reset_tokens_merchant_customer_idx').on(t.merchantId, t.customerId)]
)

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    type: varchar('type', { length: 30 }).notNull().default('email_verification'),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('verification_tokens_merchant_customer_idx').on(t.merchantId, t.customerId)]
)

/* ------------------------------ settings additions ------------------------------ */

export const checkoutSettings = pgTable('checkout_settings', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  codEnabled: boolean('cod_enabled').notNull().default(true),
  codMinValue: money('cod_min_value').notNull().default(0),
  codMaxValue: money('cod_max_value'),
  codFee: money('cod_fee').notNull().default(0),
  serviceablePincodes: jsonb('serviceable_pincodes').$type<string[]>().notNull().default([]),
  defaultShippingDays: integer('default_shipping_days').notNull().default(5),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const themeConfigs = pgTable('theme_configs', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  primaryColor: varchar('primary_color', { length: 20 }).notNull().default('#4f46e5'),
  secondaryColor: varchar('secondary_color', { length: 20 }).notNull().default('#6b7280'),
  accentColor: varchar('accent_color', { length: 20 }).notNull().default('#f59e0b'),
  logo: varchar('logo', { length: 1024 }),
  typography: jsonb('typography').notNull().default({}),
  header: jsonb('header').notNull().default({}),
  footer: jsonb('footer').notNull().default({}),
  config: jsonb('config').notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const codRules = pgTable('cod_rules', {
  merchantId: varchar('merchant_id', { length: 30 })
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  serviceablePincodes: jsonb('serviceable_pincodes').$type<string[]>().notNull().default([]),
  blacklistPincodes: jsonb('blacklist_pincodes').$type<string[]>().notNull().default([]),
  minOrderValue: money('min_order_value').notNull().default(0),
  maxOrderValue: money('max_order_value'),
  codFee: money('cod_fee').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
})

export const carriers = pgTable(
  'carriers',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    credentials: jsonb('credentials').notNull().default({}),
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [uniqueIndex('carriers_merchant_code_idx').on(t.merchantId, t.code)]
)

export const campaigns = pgTable(
  'campaigns',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 50 }).notNull().default('email'),
    audience: jsonb('audience').notNull().default({}),
    subject: varchar('subject', { length: 255 }),
    content: text('content'),
    triggerType: varchar('trigger_type', { length: 50 }),
    triggerDelayHours: integer('trigger_delay_hours').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    sentCount: integer('sent_count').notNull().default(0),
    openedCount: integer('opened_count').notNull().default(0),
    clickedCount: integer('clicked_count').notNull().default(0),
    convertedCount: integer('converted_count').notNull().default(0),
    scheduledAt: timestamp('scheduled_at'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date())
  },
  (t) => [index('campaigns_merchant_status_idx').on(t.merchantId, t.status)]
)

export const customerTags = pgTable(
  'customer_tags',
  {
    id: id('id').primaryKey(),
    merchantId: merchantIdRef(),
    customerId: varchar('customer_id', { length: 30 })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tag: varchar('tag', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [
    uniqueIndex('customer_tags_merchant_customer_tag_idx').on(t.merchantId, t.customerId, t.tag)
  ]
)

/* --------------------------------- exports -------------------------------- */

export const table = {
  merchants,
  users,
    outlets,
    merchantModules,
    roles,
    userOutlets,
    menuItems,
    modifierGroups,
    modifiers,
    menuItemModifiers,
    menuItemOutlets,
    categories,
    products,
    productVariants,
    productImages,
    inventoryLogs,
  customers,
  orders,
  orderItems,
  returnsTable,
  refunds,
  reviews,
  auditLogs,
  wishlistItems,
  coupons,
  promotions,
  storeSettings,
  paymentSettings,
  paymentProviderConfigs,
  paymentTransactions,
  webhookEvents,
  shippingSettings,
  taxSettings,
  notificationSettings,
  emailLogs,
  visits,
  tokenBlacklist,
  webhookEndpoints,
  webhookDeliveries,
  backgroundJobs,
  fulfillments,
  customerAddresses,
  carts,
  invoices,
  warehouses,
  warehouseInventory,
  stockTransfers,
  customerSegments,
  loyaltyAccounts,
  loyaltyLedger,
  affiliates,
  referrals,
  contentPages,
  apiKeys,
  passwordResetTokens,
  verificationTokens,
  checkoutSettings,
  themeConfigs,
  codRules,
  carriers,
  campaigns,
  customerTags
} as const

export type Table = typeof table

export type Merchant = typeof merchants.$inferSelect
export type NewMerchant = typeof merchants.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Outlet = typeof outlets.$inferSelect
export type NewOutlet = typeof outlets.$inferInsert
export type MerchantModule = typeof merchantModules.$inferSelect
export type NewMerchantModule = typeof merchantModules.$inferInsert
export type Role = typeof roles.$inferSelect
export type NewRole = typeof roles.$inferInsert
export type UserOutlet = typeof userOutlets.$inferSelect
export type NewUserOutlet = typeof userOutlets.$inferInsert
export type MenuItem = typeof menuItems.$inferSelect
export type NewMenuItem = typeof menuItems.$inferInsert
export type ModifierGroup = typeof modifierGroups.$inferSelect
export type NewModifierGroup = typeof modifierGroups.$inferInsert
export type Modifier = typeof modifiers.$inferSelect
export type NewModifier = typeof modifiers.$inferInsert
export type MenuItemModifier = typeof menuItemModifiers.$inferSelect
export type NewMenuItemModifier = typeof menuItemModifiers.$inferInsert
export type MenuItemOutlet = typeof menuItemOutlets.$inferSelect
export type NewMenuItemOutlet = typeof menuItemOutlets.$inferInsert
export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type ProductVariant = typeof productVariants.$inferSelect
export type NewProductVariant = typeof productVariants.$inferInsert
export type ProductImage = typeof productImages.$inferSelect
export type NewProductImage = typeof productImages.$inferInsert
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
export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert
export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
export type Coupon = typeof coupons.$inferSelect
export type NewCoupon = typeof coupons.$inferInsert
export type Promotion = typeof promotions.$inferSelect
export type NewPromotion = typeof promotions.$inferInsert
export type StoreSettings = typeof storeSettings.$inferSelect
export type PaymentSettings = typeof paymentSettings.$inferSelect
export type PaymentProviderConfig = typeof paymentProviderConfigs.$inferSelect
export type PaymentTransaction = typeof paymentTransactions.$inferSelect
export type WebhookEventRecord = typeof webhookEvents.$inferSelect
export type ShippingSettings = typeof shippingSettings.$inferSelect
export type TaxSettings = typeof taxSettings.$inferSelect
export type NotificationSettings = typeof notificationSettings.$inferSelect
export type EmailLog = typeof emailLogs.$inferSelect
export type Visit = typeof visits.$inferSelect
export type TokenBlacklist = typeof tokenBlacklist.$inferSelect
export type NewTokenBlacklist = typeof tokenBlacklist.$inferInsert

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert
export type BackgroundJob = typeof backgroundJobs.$inferSelect
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert
export type Fulfillment = typeof fulfillments.$inferSelect
export type NewFulfillment = typeof fulfillments.$inferInsert
export type CustomerAddress = typeof customerAddresses.$inferSelect
export type NewCustomerAddress = typeof customerAddresses.$inferInsert
export type Cart = typeof carts.$inferSelect
export type NewCart = typeof carts.$inferInsert
export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type Warehouse = typeof warehouses.$inferSelect
export type NewWarehouse = typeof warehouses.$inferInsert
export type WarehouseInventory = typeof warehouseInventory.$inferSelect
export type NewWarehouseInventory = typeof warehouseInventory.$inferInsert
export type StockTransfer = typeof stockTransfers.$inferSelect
export type NewStockTransfer = typeof stockTransfers.$inferInsert
export type CustomerSegment = typeof customerSegments.$inferSelect
export type NewCustomerSegment = typeof customerSegments.$inferInsert
export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect
export type NewLoyaltyAccount = typeof loyaltyAccounts.$inferInsert
export type LoyaltyEntry = typeof loyaltyLedger.$inferSelect
export type NewLoyaltyEntry = typeof loyaltyLedger.$inferInsert
export type Affiliate = typeof affiliates.$inferSelect
export type NewAffiliate = typeof affiliates.$inferInsert
export type Referral = typeof referrals.$inferSelect
export type NewReferral = typeof referrals.$inferInsert
export type ContentPage = typeof contentPages.$inferSelect
export type NewContentPage = typeof contentPages.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert
export type VerificationToken = typeof verificationTokens.$inferSelect
export type NewVerificationToken = typeof verificationTokens.$inferInsert
export type CheckoutSettings = typeof checkoutSettings.$inferSelect
export type ThemeConfig = typeof themeConfigs.$inferSelect
export type CodRules = typeof codRules.$inferSelect
export type Carrier = typeof carriers.$inferSelect
export type NewCarrier = typeof carriers.$inferInsert
export type Campaign = typeof campaigns.$inferSelect
export type NewCampaign = typeof campaigns.$inferInsert
export type CustomerTag = typeof customerTags.$inferSelect
export type NewCustomerTag = typeof customerTags.$inferInsert
