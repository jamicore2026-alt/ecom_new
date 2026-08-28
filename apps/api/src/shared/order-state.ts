import {
  FOOD_ORDER_TYPES,
  FOOD_ORDER_STATUSES,
  FOOD_STATUS_TRANSITIONS,
  ORDER_TYPES,
  type FoodOrderStatus
} from './types'
import { badRequest, conflict } from './errors'

/** True when `orderType` is a food order kind that uses the food lifecycle. */
export const isFoodOrderType = (orderType: string | null | undefined) =>
  !!orderType && (FOOD_ORDER_TYPES as readonly string[]).includes(orderType)

/** True when `status` is a food lifecycle state. */
export const isFoodOrderStatus = (status: string) =>
  (FOOD_ORDER_STATUSES as readonly string[]).includes(status)

export const isValidOrderType = (orderType: string) =>
  (ORDER_TYPES as readonly string[]).includes(orderType)

/**
 * Validate a status transition for an order. Food order types must move along
 * the food lifecycle; ecommerce orders reject food states and vice versa.
 * Throws conflict (409) on an invalid move.
 */
export function assertOrderTransition(
  currentStatus: string,
  nextStatus: string,
  orderType: string | null | undefined
): void {
  const foodType = isFoodOrderType(orderType)

  if (foodType) {
    if (!isFoodOrderStatus(nextStatus)) {
      throw badRequest('INVALID_FOOD_STATUS', `${nextStatus} is not a food order status`)
    }
    const allowed = FOOD_STATUS_TRANSITIONS[currentStatus as FoodOrderStatus]
    if (!allowed.includes(nextStatus as FoodOrderStatus)) {
      throw conflict(
        'INVALID_TRANSITION',
        `Cannot move food order from ${currentStatus} to ${nextStatus}`
      )
    }
    return
  }

  if (isFoodOrderStatus(nextStatus)) {
    throw badRequest('INVALID_STATUS_FOR_TYPE', `${nextStatus} is only valid for food orders`)
  }
  if (currentStatus === nextStatus) return
  // ecommerce lifecycle is still guarded by the existing orders service.
}
