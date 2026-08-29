import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_TRANSITIONS,
  DRIVER_STATUSES,
  DRIVER_STATUS_TRANSITIONS,
  type DeliveryStatus,
  type DriverStatus
} from './types'
import { badRequest, conflict } from './errors'

export const isDeliveryStatus = (s: string): s is DeliveryStatus =>
  (DELIVERY_STATUSES as readonly string[]).includes(s)
export const isDriverStatus = (s: string): s is DriverStatus =>
  (DRIVER_STATUSES as readonly string[]).includes(s)

/** Throws if `next` is not a valid successor of `current`. Keyed by CURRENT state. */
export function assertDeliveryTransition(current: string, next: string): void {
  if (!isDeliveryStatus(current)) throw badRequest('INVALID_DELIVERY_STATUS', `Unknown delivery status: ${current}`)
  if (!isDeliveryStatus(next)) throw badRequest('INVALID_DELIVERY_STATUS', `Unknown delivery status: ${next}`)
  const allowed = DELIVERY_STATUS_TRANSITIONS[current as DeliveryStatus]
  if (!allowed.includes(next as DeliveryStatus)) {
    throw conflict('INVALID_TRANSITION', `Cannot move delivery from ${current} to ${next}`)
  }
}

/** Throws if `next` is not a valid successor of `current` for a driver. */
export function assertDriverTransition(current: string, next: string): void {
  if (!isDriverStatus(current)) throw badRequest('INVALID_DRIVER_STATUS', `Unknown driver status: ${current}`)
  if (!isDriverStatus(next)) throw badRequest('INVALID_DRIVER_STATUS', `Unknown driver status: ${next}`)
  const allowed = DRIVER_STATUS_TRANSITIONS[current as DriverStatus]
  if (!allowed.includes(next as DriverStatus)) {
    throw conflict('INVALID_TRANSITION', `Cannot move driver from ${current} to ${next}`)
  }
}
