import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  orders,
  outlets,
  paymentTransactions,
  registerShifts
} from '../../database/schema'
import { ok } from '../../shared/response'
import { parsePagination, makeMeta } from '../../shared/pagination'
import { badRequest, notFound, conflict } from '../../shared/errors'
import {
  assertInOutletScope,
  effectiveOutletIds,
  outletScopeError,
  type OutletScope
} from '../../shared/outlet-scope'

export type CashMovement = { amount: number; reason?: string; at: string }

const round2 = (n: number) => Number(n.toFixed(2))
const sumMovements = (rows: CashMovement[] | null | undefined) =>
  round2((rows ?? []).reduce((acc, m) => acc + Number(m.amount), 0))

const isOpen = (status: string) => status === 'open'

/** Cash sales for an outlet inside [from, to]: paid `cash` payment_txns joined via orders. */
async function cashSalesInWindow(
  db: DB,
  merchantId: string,
  outletId: string,
  from: Date,
  to: Date
): Promise<{ total: number; count: number }> {
  const rows = await db
    .select({ amount: paymentTransactions.amount })
    .from(paymentTransactions)
    .innerJoin(orders, eq(paymentTransactions.orderId, orders.id))
    .where(
      and(
        eq(paymentTransactions.merchantId, merchantId),
        eq(paymentTransactions.provider, 'cash'),
        eq(paymentTransactions.status, 'paid'),
        eq(orders.merchantId, merchantId),
        eq(orders.outletId, outletId),
        gte(paymentTransactions.createdAt, from),
        lte(paymentTransactions.createdAt, to)
      )
    )
  return {
    total: round2(rows.reduce((acc, r) => acc + Number(r.amount), 0)),
    count: rows.length
  }
}

export interface ZReport {
  shiftId: string
  outletId: string | null
  openedAt: Date
  closedAt: Date
  openedBy: string
  closedBy: string | null
  openBank: number
  cashSales: number
  cashSalesCount: number
  dropsTotal: number
  payoutsTotal: number
  expectedCash: number
  actualCash: number
  variance: number
}

export async function buildZReport(
  db: DB,
  merchantId: string,
  shift: typeof registerShifts.$inferSelect,
  closedAt: Date,
  actualCash: number
): Promise<ZReport> {
  const dropsTotal = sumMovements(shift.drops)
  const payoutsTotal = sumMovements(shift.payouts)
  const { total: cashSales, count: cashSalesCount } = shift.outletId
    ? await cashSalesInWindow(db, merchantId, shift.outletId, new Date(shift.openedAt), closedAt)
    : { total: 0, count: 0 }
  const expectedCash = round2(Number(shift.openBank) + cashSales + dropsTotal - payoutsTotal)
  return {
    shiftId: shift.id,
    outletId: shift.outletId,
    openedAt: shift.openedAt,
    closedAt,
    openedBy: shift.openedBy,
    closedBy: shift.closedBy,
    openBank: Number(shift.openBank),
    cashSales,
    cashSalesCount,
    dropsTotal,
    payoutsTotal,
    expectedCash,
    actualCash: round2(actualCash),
    variance: round2(actualCash - expectedCash)
  }
}

const shiftWithOutlet = async (db: DB, merchantId: string, id: string) => {
  const [row] = await db
    .select({ shift: registerShifts, outletName: outlets.name })
    .from(registerShifts)
    .leftJoin(outlets, eq(registerShifts.outletId, outlets.id))
    .where(and(eq(registerShifts.id, id), eq(registerShifts.merchantId, merchantId)))
  return row ?? null
}

export class RegisterShiftsService {
  static async list(
    db: DB,
    merchantId: string,
    query: { outletId?: string; status?: string; page?: number; limit?: number },
    scope: OutletScope
  ) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok({ items: [], meta: makeMeta(1, 20, 0) })
    if (query.status !== undefined && !['open', 'closed'].includes(query.status)) {
      throw badRequest('INVALID_SHIFT_STATUS', 'Unknown shift status')
    }
    const conds: SQL[] = [eq(registerShifts.merchantId, merchantId)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(registerShifts.outletId, query.outletId))
    }
    if (query.status) conds.push(eq(registerShifts.status, query.status))
    const { page, limit, offset } = parsePagination(query)
    const where = and(...conds)
    const [{ value: total }] = await db.select({ value: count() }).from(registerShifts).where(where)
    const rows = await db
      .select()
      .from(registerShifts)
      .where(where)
      .orderBy(desc(registerShifts.openedAt))
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, total) })
  }

  static async get(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const row = await shiftWithOutlet(db, merchantId, id)
    if (!row) throw notFound('SHIFT_NOT_FOUND', 'Register shift not found')
    assertInOutletScope(scope, row.shift.outletId)
    return ok({ ...row.shift, outletName: row.outletName })
  }

  static async current(db: DB, merchantId: string, outletId: string, scope: OutletScope) {
    assertInOutletScope(scope, outletId)
    const [row] = await db
      .select()
      .from(registerShifts)
      .where(
        and(
          eq(registerShifts.merchantId, merchantId),
          eq(registerShifts.outletId, outletId),
          eq(registerShifts.status, 'open')
        )
      )
    return ok(row ?? null)
  }

  static async open(
    db: DB,
    merchantId: string,
    userId: string,
    input: { outletId: string; openBank?: number },
    scope: OutletScope
  ) {
    assertInOutletScope(scope, input.outletId)
    const openBank = input.openBank ?? 0
    if (!(openBank >= 0)) throw badRequest('INVALID_OPEN_BANK', 'Opening bank must be >= 0')
    const [outlet] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
    if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')

    const [existing] = await db
      .select({ id: registerShifts.id })
      .from(registerShifts)
      .where(
        and(
          eq(registerShifts.merchantId, merchantId),
          eq(registerShifts.outletId, input.outletId),
          eq(registerShifts.status, 'open')
        )
      )
    if (existing) throw conflict('SHIFT_ALREADY_OPEN', 'This outlet already has an open shift')

    const [row] = await db
      .insert(registerShifts)
      .values({
        merchantId,
        outletId: input.outletId,
        openedBy: userId,
        openBank,
        status: 'open',
        drops: [],
        payouts: []
      })
      .returning()
    return ok(row)
  }

  private static async requireOpenShift(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [shift] = await db
      .select()
      .from(registerShifts)
      .where(and(eq(registerShifts.id, id), eq(registerShifts.merchantId, merchantId)))
    if (!shift) throw notFound('SHIFT_NOT_FOUND', 'Register shift not found')
    assertInOutletScope(scope, shift.outletId)
    if (!isOpen(shift.status)) throw conflict('SHIFT_CLOSED', 'This shift is already closed')
    return shift
  }

  static async recordDrop(
    db: DB,
    merchantId: string,
    id: string,
    input: { amount: number; reason?: string },
    scope: OutletScope
  ) {
    if (!(input.amount > 0)) throw badRequest('INVALID_AMOUNT', 'Drop amount must be > 0')
    const shift = await this.requireOpenShift(db, merchantId, id, scope)
    const drops: CashMovement[] = [
      ...(shift.drops ?? []),
      { amount: round2(input.amount), ...(input.reason ? { reason: input.reason } : {}), at: new Date().toISOString() }
    ]
    const [updated] = await db
      .update(registerShifts)
      .set({ drops })
      .where(eq(registerShifts.id, id))
      .returning()
    return ok(updated)
  }

  static async recordPayout(
    db: DB,
    merchantId: string,
    id: string,
    input: { amount: number; reason?: string },
    scope: OutletScope
  ) {
    if (!(input.amount > 0)) throw badRequest('INVALID_AMOUNT', 'Payout amount must be > 0')
    const shift = await this.requireOpenShift(db, merchantId, id, scope)
    const payouts: CashMovement[] = [
      ...(shift.payouts ?? []),
      { amount: round2(input.amount), ...(input.reason ? { reason: input.reason } : {}), at: new Date().toISOString() }
    ]
    const [updated] = await db
      .update(registerShifts)
      .set({ payouts })
      .where(eq(registerShifts.id, id))
      .returning()
    return ok(updated)
  }

  static async close(
    db: DB,
    merchantId: string,
    userId: string,
    id: string,
    input: { actualCash: number },
    scope: OutletScope
  ) {
    if (input.actualCash === undefined || input.actualCash === null || !(input.actualCash >= 0)) {
      throw badRequest('ACTUAL_CASH_REQUIRED', 'Counted cash (actualCash >= 0) is required to close a shift')
    }
    const shift = await this.requireOpenShift(db, merchantId, id, scope)
    const closedAt = new Date()
    // Re-read inside the report uses the pre-close row; compute before persisting.
    const report = await buildZReport(db, merchantId, { ...shift, closedBy: userId }, closedAt, input.actualCash)
    const [closed] = await db
      .update(registerShifts)
      .set({
        status: 'closed',
        expectedCash: report.expectedCash,
        actualCash: report.actualCash,
        closedBy: userId,
        closedAt
      })
      .where(and(eq(registerShifts.id, id), eq(registerShifts.status, 'open')))
      .returning()
    if (!closed) throw conflict('SHIFT_CLOSED', 'This shift is already closed')
    return ok({ shift: closed, zReport: report })
  }
}
