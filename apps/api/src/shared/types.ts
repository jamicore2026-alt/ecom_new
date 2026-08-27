export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_PAYMENT_STATUSES = ['unpaid', 'paid', 'partially_refunded', 'refunded', 'failed'] as const
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number]

export const ORDER_FULFILLMENT_STATUSES = ['unfulfilled', 'fulfilled'] as const
export type OrderFulfillmentStatus = (typeof ORDER_FULFILLMENT_STATUSES)[number]

export const USER_ROLES = ['owner', 'admin', 'staff'] as const
export type UserRole = (typeof USER_ROLES)[number]

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
  | 'products:write'
  | 'orders:write'
  | 'inventory:write'
  | 'discounts:write'
  | 'settings:write'
  | 'analytics:read'

export const PERMISSIONS: Permission[] = [
  'products:write',
  'orders:write',
  'inventory:write',
  'discounts:write',
  'settings:write',
  'analytics:read'
]

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
