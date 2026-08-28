export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_PAYMENT_STATUSES = ['unpaid', 'paid', 'partially_refunded', 'refunded', 'failed'] as const
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number]

export const ORDER_FULFILLMENT_STATUSES = ['unfulfilled', 'fulfilled'] as const
export type OrderFulfillmentStatus = (typeof ORDER_FULFILLMENT_STATUSES)[number]

/* ------------------------- food order types/state ------------------------- */

export const ORDER_TYPES = ['ecommerce', 'DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QR', 'POS', 'SCHEDULED'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export const FOOD_ORDER_TYPES: OrderType[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QR', 'POS', 'SCHEDULED']

export const FOOD_ORDER_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED'
] as const
export type FoodOrderStatus = (typeof FOOD_ORDER_STATUSES)[number]

/** Valid food-order state transitions (validated, no raw status assignments). */
export const FOOD_STATUS_TRANSITIONS: Record<FoodOrderStatus, FoodOrderStatus[]> = {
  CREATED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
}

export type FoodOrderModifier = {
  modifierId: string
  groupName: string
  name: string
  priceAdjustment: number
  quantity: number
}

/* --------------------------- dine-in: tables/QR --------------------------- */

export const TABLE_STATES = [
  'AVAILABLE',
  'RESERVED',
  'OCCUPIED',
  'ORDERING',
  'DINING',
  'BILL_REQUESTED',
  'PAYMENT_PENDING',
  'CLEANING'
] as const
export type TableState = (typeof TABLE_STATES)[number]

/** Valid table-state transitions (validated — no raw status assignments). */
export const TABLE_STATUS_TRANSITIONS: Record<TableState, TableState[]> = {
  AVAILABLE: ['RESERVED', 'OCCUPIED', 'ORDERING'],
  RESERVED: ['AVAILABLE', 'OCCUPIED', 'ORDERING'],
  OCCUPIED: ['ORDERING', 'DINING', 'BILL_REQUESTED', 'AVAILABLE'],
  ORDERING: ['DINING', 'BILL_REQUESTED', 'OCCUPIED'],
  DINING: ['BILL_REQUESTED', 'ORDERING', 'OCCUPIED'],
  BILL_REQUESTED: ['PAYMENT_PENDING', 'DINING'],
  PAYMENT_PENDING: ['BILL_REQUESTED', 'AVAILABLE', 'CLEANING'],
  CLEANING: ['AVAILABLE']
}

export const TABLE_SESSION_STATUSES = ['OPEN', 'CLOSED', 'CANCELLED'] as const
export type TableSessionStatus = (typeof TABLE_SESSION_STATUSES)[number]

/** Valid table-session transitions. OPEN parties can always be moved/merged/split. */
export const TABLE_SESSION_TRANSITIONS: Record<TableSessionStatus, TableSessionStatus[]> = {
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: []
}

/** Built-in/default roles. `owner`, `admin` and `staff` are the legacy
 *  values still stored on `users.role` (kept for backward compatibility with
 *  existing fixtures/tests). The others are the plan's default roles and are
 *  stored as custom `roles` rows (see `DEFAULT_ROLES`). */
export const USER_ROLES = [
  'owner',
  'admin',
  'staff',
  'manager',
  'cashier',
  'captain',
  'kitchen_manager',
  'kitchen_staff',
  'inventory_manager',
  'delivery_manager',
  'driver',
  'accountant',
  'support'
] as const
export type UserRole = (typeof USER_ROLES)[number]

/** Roles seeded per merchant when `roles` is (re)initialized. */
export const DEFAULT_ROLES: Array<{ name: UserRole; permissions: Permission[]; scope: Scope }> = [
  { name: 'owner', permissions: [], scope: 'GLOBAL' },
  { name: 'admin', permissions: [], scope: 'GLOBAL' },
  { name: 'manager', permissions: ['orders.read', 'orders.create', 'orders.update', 'orders.cancel', 'products.read', 'products.update', 'menu.read', 'menu.manage', 'kitchen.read', 'kds.read', 'tables.read', 'tables.manage', 'inventory.read', 'inventory.adjust', 'payments.read', 'payments.create', 'reports.read', 'staff.read', 'settings.read'], scope: 'MERCHANT' },
  { name: 'cashier', permissions: ['orders.read', 'orders.create', 'orders.update', 'payments.read', 'payments.create', 'tables.read', 'tables.manage'], scope: 'OUTLET' },
  { name: 'captain', permissions: ['orders.read', 'orders.create', 'orders.update', 'tables.read', 'tables.manage'], scope: 'OUTLET' },
  { name: 'kitchen_manager', permissions: ['kitchen.read', 'kitchen.manage', 'kds.read', 'kds.manage', 'menu.read'], scope: 'OUTLET' },
  { name: 'kitchen_staff', permissions: ['kitchen.read', 'kds.read', 'kds.manage'], scope: 'OUTLET' },
  { name: 'inventory_manager', permissions: ['inventory.read', 'inventory.adjust', 'inventory.manage', 'products.read'], scope: 'OUTLET' },
  { name: 'delivery_manager', permissions: ['delivery.read', 'delivery.assign', 'delivery.manage', 'drivers.read', 'drivers.manage', 'orders.read'], scope: 'OUTLET' },
  { name: 'driver', permissions: ['delivery.read', 'orders.read'], scope: 'OWN' },
  { name: 'accountant', permissions: ['reports.read', 'payments.read', 'inventory.read', 'orders.read'], scope: 'MERCHANT' },
  { name: 'support', permissions: ['orders.read', 'customers.read'], scope: 'MERCHANT' }
]

export const USER_STATUSES = ['active', 'invited', 'disabled'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const COUPON_TYPES = ['percentage', 'fixed', 'free_shipping'] as const
export type CouponType = (typeof COUPON_TYPES)[number]

export const PROMOTION_TYPES = ['discount_on_products', 'buy_x_get_y'] as const
export type PromotionType = (typeof PROMOTION_TYPES)[number]

export const RETURN_STATUSES = ['pending', 'approved', 'rejected', 'restocked'] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

/** Only gateway/original refunds exist today — wallet/store-credit needs a
 *  credit ledger that is not implemented yet. Revisit when a wallet ships. */
export const REFUND_METHODS = ['original'] as const
export type RefundMethod = (typeof REFUND_METHODS)[number]

export const REFUND_STATUSES = ['pending', 'completed'] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]

export const INVENTORY_REASONS = ['sale', 'adjustment', 'purchase', 'return', 'cancel'] as const
export type InventoryReason = (typeof INVENTORY_REASONS)[number]

export const CHANNELS = ['organic', 'paid', 'social', 'email', 'direct'] as const
export type Channel = (typeof CHANNELS)[number]

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export interface Address {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
}

export type Permission =
  // legacy (backward compatible)
  | 'products:write'
  | 'orders:write'
  | 'inventory:write'
  | 'discounts:write'
  | 'settings:write'
  | 'analytics:read'
  // orders
  | 'orders.read'
  | 'orders.create'
  | 'orders.update'
  | 'orders.cancel'
  // products
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  // menu
  | 'menu.read'
  | 'menu.manage'
  // kitchen / KDS
  | 'kitchen.read'
  | 'kitchen.manage'
  | 'kds.read'
  | 'kds.manage'
  // tables
  | 'tables.read'
  | 'tables.manage'
  // delivery / drivers
  | 'delivery.read'
  | 'delivery.assign'
  | 'delivery.manage'
  | 'drivers.read'
  | 'drivers.manage'
  // inventory
  | 'inventory.read'
  | 'inventory.adjust'
  | 'inventory.manage'
  // payments
  | 'payments.read'
  | 'payments.create'
  | 'payments.refund'
  // reports
  | 'reports.read'
  // staff / customers / settings
  | 'staff.read'
  | 'staff.manage'
  | 'customers.read'
  | 'settings.read'
  | 'settings.manage'

export const PERMISSIONS: Permission[] = [
  'products:write',
  'orders:write',
  'inventory:write',
  'discounts:write',
  'settings:write',
  'analytics:read',
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'menu.read',
  'menu.manage',
  'kitchen.read',
  'kitchen.manage',
  'kds.read',
  'kds.manage',
  'tables.read',
  'tables.manage',
  'delivery.read',
  'delivery.assign',
  'delivery.manage',
  'drivers.read',
  'drivers.manage',
  'inventory.read',
  'inventory.adjust',
  'inventory.manage',
  'payments.read',
  'payments.create',
  'payments.refund',
  'reports.read',
  'staff.read',
  'staff.manage',
  'customers.read',
  'settings.read',
  'settings.manage'
]

/* ------------------------------ scopes ------------------------------ */

/** Authorization scope of a user/role relative to their merchant. */
export const SCOPES = ['GLOBAL', 'MERCHANT', 'OUTLET', 'OWN'] as const
export type Scope = (typeof SCOPES)[number]

/* ------------------------------ modules ------------------------------ */

export const MODULES = [
  'commerce',
  'restaurant',
  'pos',
  'kitchen',
  'tables',
  'delivery',
  'inventory',
  'marketing',
  'analytics'
] as const
export type ModuleId = (typeof MODULES)[number]

/** Sensible default module sets per merchant kind (seeded on creation). */
export const DEFAULT_MODULES: Record<'commerce', ModuleId[]> = {
  commerce: ['commerce', 'inventory', 'marketing', 'analytics']
}

export const OUTLET_STATUSES = ['active', 'inactive', 'archived'] as const
export type OutletStatus = (typeof OUTLET_STATUSES)[number]

export const revenueStatuses: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered']

/* --------------------------- fulfillment --------------------------- */

export const FULFILLMENT_STATUSES = ['unfulfilled', 'processing', 'packed', 'shipped', 'delivered', 'failed', 'returned', 'cancelled'] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

/* --------------------------- outbound webhooks --------------------------- */

export const OUTBOUND_WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.cancelled',
  'order.shipped',
  'order.delivered',
  'refund.created',
  'refund.completed',
  'return.created',
  'return.approved',
  'product.created',
  'product.updated',
  'inventory.updated',
  'customer.created',
  'fulfillment.created',
  'fulfillment.updated'
] as const
export type OutboundWebhookEvent = (typeof OUTBOUND_WEBHOOK_EVENTS)[number]

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number]

/* --------------------------- jobs --------------------------- */

export const JOB_TYPES = ['email', 'webhook_delivery', 'abandoned_cart', 'reconcile', 'cleanup', 'invoice_generation', 'stock_alert'] as const
export type JobType = (typeof JOB_TYPES)[number]

export const JOB_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/* --------------------------- addresses --------------------------- */

export const ADDRESS_TYPES = ['shipping', 'billing', 'both'] as const
export type AddressType = (typeof ADDRESS_TYPES)[number]

/* --------------------------- warehouses --------------------------- */

export const WAREHOUSE_STATUSES = ['active', 'inactive', 'archived'] as const
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number]

/* --------------------------- loyalty --------------------------- */

export const LOYALTY_LEDGER_TYPES = ['earn', 'redeem', 'adjust', 'expire', 'refund'] as const
export type LoyaltyLedgerType = (typeof LOYALTY_LEDGER_TYPES)[number]

/* --------------------------- affiliate --------------------------- */

export const AFFILIATE_STATUSES = ['active', 'suspended', 'archived'] as const
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number]

export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number]

/* --------------------------- CMS --------------------------- */

export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/* --------------------------- API keys --------------------------- */

export const API_KEY_SCOPES = [
  'products:read', 'products:write',
  'orders:read', 'orders:write',
  'customers:read', 'customers:write',
  'inventory:read', 'inventory:write',
  'webhooks:read', 'webhooks:write'
] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]
