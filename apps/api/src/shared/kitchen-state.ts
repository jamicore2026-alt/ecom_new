import {
  KOT_STATUSES,
  KOT_STATUS_TRANSITIONS,
  KITCHEN_ITEM_STATUSES,
  type KotStatus,
  type KitchenItemStatus
} from './types'
import { badRequest, conflict } from './errors'

export const isKotStatus = (s: string): s is KotStatus => (KOT_STATUSES as readonly string[]).includes(s)
export const isKitchenItemStatus = (s: string): s is KitchenItemStatus =>
  (KITCHEN_ITEM_STATUSES as readonly string[]).includes(s)

/** Throws if `next` is not a valid successor of `current`. Keyed by CURRENT state. */
export function assertKotTransition(current: string, next: string): void {
  if (!isKotStatus(current)) throw badRequest('INVALID_KOT_STATUS', `Unknown KOT status: ${current}`)
  if (!isKotStatus(next)) throw badRequest('INVALID_KOT_STATUS', `Unknown KOT status: ${next}`)
  const allowed = KOT_STATUS_TRANSITIONS[current as KotStatus]
  if (!allowed.includes(next as KotStatus)) {
    throw conflict('INVALID_TRANSITION', `Cannot move ticket from ${current} to ${next}`)
  }
}
