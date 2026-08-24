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

export const REFUND_METHODS = ['original', 'credit', 'store_credit'] as const
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
