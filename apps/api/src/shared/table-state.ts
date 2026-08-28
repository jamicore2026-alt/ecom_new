import {
  TABLE_STATUS_TRANSITIONS,
  TABLE_SESSION_TRANSITIONS,
  TABLE_STATES,
  TABLE_SESSION_STATUSES,
  type TableState,
  type TableSessionStatus
} from './types'
import { badRequest, conflict } from './errors'

export const isTableState = (s: string): s is TableState => (TABLE_STATES as readonly string[]).includes(s)
export const isSessionStatus = (s: string): s is TableSessionStatus => (TABLE_SESSION_STATUSES as readonly string[]).includes(s)

/** Throws if `next` is not a valid successor of `current`. Keyed by CURRENT state. */
export function assertTableTransition(current: string, next: string): void {
  if (!isTableState(current)) throw badRequest('INVALID_TABLE_STATE', `Unknown table state: ${current}`)
  if (!isTableState(next)) throw badRequest('INVALID_TABLE_STATE', `Unknown table state: ${next}`)
  const allowed = TABLE_STATUS_TRANSITIONS[current as TableState]
  if (!allowed.includes(next as TableState)) {
    throw conflict('INVALID_TRANSITION', `Cannot move table from ${current} to ${next}`)
  }
}

/** Throws if a session state change is invalid. */
export function assertSessionTransition(current: string, next: string): void {
  if (!isSessionStatus(current)) throw badRequest('INVALID_SESSION_STATUS', `Unknown session status: ${current}`)
  if (!isSessionStatus(next)) throw badRequest('INVALID_SESSION_STATUS', `Unknown session status: ${next}`)
  const allowed = TABLE_SESSION_TRANSITIONS[current as TableSessionStatus]
  if (!allowed.includes(next as TableSessionStatus)) {
    throw conflict('INVALID_TRANSITION', `Cannot move session from ${current} to ${next}`)
  }
}
