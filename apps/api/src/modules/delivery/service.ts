import { and, asc, count, desc, eq, isNull, notInArray } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  deliveryZones,
  deliveryOrders,
  drivers,
  driverLocations,
  driverAssignments,
  orders,
  outlets,
  users
} from '../../database/schema'
import { ok } from '../../shared/response'
import { parsePagination, makeMeta } from '../../shared/pagination'
import { badRequest, notFound, conflict } from '../../shared/errors'
import { assertDeliveryTransition, assertDriverTransition, isDeliveryStatus, isDriverStatus } from '../../shared/delivery-state'
import type { Address, DeliveryStatus, DeliveryZoneStatus } from '../../shared/types'

const TERMINAL_DELIVERY = ['DELIVERED', 'FAILED', 'CANCELLED'] as const

const activeDeliveryOnDriver = (driverId: string) =>
  and(eq(deliveryOrders.assignedDriverId, driverId), notInArray(deliveryOrders.status, [...TERMINAL_DELIVERY]))

const deliveryTimestampsFor = (status: DeliveryStatus) => {
  switch (status) {
    case 'PICKED_UP':
      return { pickedUpAt: new Date() }
    case 'ARRIVED_AT_PICKUP':
      return { pickupAt: new Date() }
    case 'ARRIVED':
      return { arrivedAt: new Date() }
    case 'DELIVERED':
      return { deliveredAt: new Date() }
    case 'CANCELLED':
      return { cancelledAt: new Date() }
    default:
      return {}
  }
}

/* ------------------------------ delivery zones ------------------------------ */

export class DeliveryZonesService {
  static async list(merchantId: string, query: { outletId?: string }) {
    const conds = [eq(deliveryZones.merchantId, merchantId)]
    if (query.outletId) conds.push(eq(deliveryZones.outletId, query.outletId))
    const rows = await db
      .select()
      .from(deliveryZones)
      .where(and(...conds))
      .orderBy(asc(deliveryZones.name))
    return ok(rows)
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.id, id), eq(deliveryZones.merchantId, merchantId)))
    if (!row) throw notFound('ZONE_NOT_FOUND', 'Delivery zone not found')
    return ok(row)
  }

  static async create(
    merchantId: string,
    input: {
      name: string
      outletId?: string
      centerLat: number
      centerLng: number
      radiusKm?: number
      deliveryFee?: number
      minOrder?: number
      freeDeliveryThreshold?: number
      etaMin?: number
      status?: string
    }
  ) {
    const [dup] = await db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.merchantId, merchantId), eq(deliveryZones.name, input.name)))
    if (dup) throw conflict('ZONE_EXISTS', `A delivery zone named "${input.name}" already exists`)
    if (input.outletId) {
      const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
      if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    }
    const [row] = await db
      .insert(deliveryZones)
      .values({
        merchantId,
        name: input.name,
        outletId: input.outletId ?? null,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        radiusKm: input.radiusKm ?? 5,
        deliveryFee: input.deliveryFee ?? 0,
        minOrder: input.minOrder ?? 0,
        freeDeliveryThreshold: input.freeDeliveryThreshold ?? null,
        etaMin: input.etaMin ?? 30,
        status: (input.status ?? 'active') as DeliveryZoneStatus
      })
      .returning()
    return ok(row)
  }

  static async update(
    merchantId: string,
    id: string,
    input: Partial<{
      name: string
      outletId?: string
      centerLat: number
      centerLng: number
      radiusKm: number
      deliveryFee: number
      minOrder: number
      freeDeliveryThreshold: number
      etaMin: number
      status: string
    }>
  ) {
    const [existing] = await db.select().from(deliveryZones).where(and(eq(deliveryZones.id, id), eq(deliveryZones.merchantId, merchantId)))
    if (!existing) throw notFound('ZONE_NOT_FOUND', 'Delivery zone not found')
    if (input.name && input.name !== existing.name) {
      const [dup] = await db.select().from(deliveryZones).where(and(eq(deliveryZones.merchantId, merchantId), eq(deliveryZones.name, input.name)))
      if (dup) throw conflict('ZONE_EXISTS', `A delivery zone named "${input.name}" already exists`)
    }
    const [updated] = await db
      .update(deliveryZones)
      .set({
        name: input.name ?? existing.name,
        outletId: input.outletId !== undefined ? input.outletId : existing.outletId,
        centerLat: input.centerLat ?? existing.centerLat,
        centerLng: input.centerLng ?? existing.centerLng,
        radiusKm: input.radiusKm ?? existing.radiusKm,
        deliveryFee: input.deliveryFee ?? existing.deliveryFee,
        minOrder: input.minOrder ?? existing.minOrder,
        freeDeliveryThreshold:
          input.freeDeliveryThreshold !== undefined ? input.freeDeliveryThreshold : existing.freeDeliveryThreshold,
        etaMin: input.etaMin ?? existing.etaMin,
        status: (input.status ?? existing.status) as DeliveryZoneStatus
      })
      .where(eq(deliveryZones.id, id))
      .returning()
    return ok(updated)
  }

  static async remove(merchantId: string, id: string) {
    const [existing] = await db.select().from(deliveryZones).where(and(eq(deliveryZones.id, id), eq(deliveryZones.merchantId, merchantId)))
    if (!existing) throw notFound('ZONE_NOT_FOUND', 'Delivery zone not found')
    const active = await db
      .select({ id: deliveryOrders.id })
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.zoneId, id), notInArray(deliveryOrders.status, [...TERMINAL_DELIVERY])))
    if (active.length > 0) throw conflict('ZONE_BUSY', 'This zone still has active deliveries')
    await db.delete(deliveryZones).where(eq(deliveryZones.id, id))
    return ok({ id, deleted: true })
  }
}

/* ------------------------------ drivers ------------------------------ */

export class DriversService {
  static async findByUser(merchantId: string, userId: string) {
    const [driver] = await db
      .select()
      .from(drivers)
      .where(and(eq(drivers.merchantId, merchantId), eq(drivers.userId, userId)))
    return driver ?? null
  }

  static async list(merchantId: string, query: { outletId?: string; status?: string; search?: string; page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(query)
    const conds = [eq(drivers.merchantId, merchantId)]
    if (query.outletId) conds.push(eq(drivers.assignedOutletId, query.outletId))
    if (query.status) {
      if (!isDriverStatus(query.status)) throw badRequest('INVALID_DRIVER_STATUS', 'Unknown driver status')
      conds.push(eq(drivers.status, query.status))
    }
    if (query.search) conds.push(eq(drivers.name, query.search.trim()))

    const where = and(...conds)
    const [{ value: total }] = await db.select({ value: count() }).from(drivers).where(where)
    const rows = await db
      .select({
        id: drivers.id,
        userId: drivers.userId,
        name: drivers.name,
        phone: drivers.phone,
        email: drivers.email,
        vehicleType: drivers.vehicleType,
        vehiclePlate: drivers.vehiclePlate,
        status: drivers.status,
        assignedOutletId: drivers.assignedOutletId,
        outletName: outlets.name,
        createdAt: drivers.createdAt
      })
      .from(drivers)
      .leftJoin(outlets, eq(drivers.assignedOutletId, outlets.id))
      .where(where)
      .orderBy(asc(drivers.name))
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, total) })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select({
        id: drivers.id,
        userId: drivers.userId,
        name: drivers.name,
        phone: drivers.phone,
        email: drivers.email,
        vehicleType: drivers.vehicleType,
        vehiclePlate: drivers.vehiclePlate,
        status: drivers.status,
        assignedOutletId: drivers.assignedOutletId,
        outletName: outlets.name,
        createdAt: drivers.createdAt,
        updatedAt: drivers.updatedAt
      })
      .from(drivers)
      .leftJoin(outlets, eq(drivers.assignedOutletId, outlets.id))
      .where(and(eq(drivers.id, id), eq(drivers.merchantId, merchantId)))
    if (!row) throw notFound('DRIVER_NOT_FOUND', 'Driver not found')
    return ok(row)
  }

  static async create(
    merchantId: string,
    input: { userId: string; name: string; phone?: string; email?: string; vehicleType?: string; vehiclePlate?: string; assignedOutletId?: string }
  ) {
    const [user] = await db.select().from(users).where(and(eq(users.id, input.userId), eq(users.merchantId, merchantId)))
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found')
    const [dup] = await db.select().from(drivers).where(and(eq(drivers.merchantId, merchantId), eq(drivers.userId, input.userId)))
    if (dup) throw conflict('DRIVER_EXISTS', 'This user is already a driver')
    if (input.assignedOutletId) {
      const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.assignedOutletId), eq(outlets.merchantId, merchantId)))
      if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    }
    const [row] = await db.insert(drivers).values({
      merchantId,
      userId: input.userId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      vehicleType: input.vehicleType ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      status: 'OFFLINE',
      assignedOutletId: input.assignedOutletId ?? null
    }).returning()
    return ok(row)
  }

  static async update(
    merchantId: string,
    id: string,
    input: Partial<{ userId: string; name: string; phone?: string; email?: string; vehicleType?: string; vehiclePlate?: string; assignedOutletId?: string }>
  ) {
    const [existing] = await db.select().from(drivers).where(and(eq(drivers.id, id), eq(drivers.merchantId, merchantId)))
    if (!existing) throw notFound('DRIVER_NOT_FOUND', 'Driver not found')
    if (input.assignedOutletId !== undefined && input.assignedOutletId !== null) {
      const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.assignedOutletId), eq(outlets.merchantId, merchantId)))
      if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    }
    const [updated] = await db
      .update(drivers)
      .set({
        name: input.name ?? existing.name,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        email: input.email !== undefined ? input.email : existing.email,
        vehicleType: input.vehicleType !== undefined ? input.vehicleType : existing.vehicleType,
        vehiclePlate: input.vehiclePlate !== undefined ? input.vehiclePlate : existing.vehiclePlate,
        assignedOutletId: input.assignedOutletId !== undefined ? input.assignedOutletId : existing.assignedOutletId
      })
      .where(eq(drivers.id, id))
      .returning()
    return ok(updated)
  }

  static async remove(merchantId: string, id: string) {
    const [existing] = await db.select().from(drivers).where(and(eq(drivers.id, id), eq(drivers.merchantId, merchantId)))
    if (!existing) throw notFound('DRIVER_NOT_FOUND', 'Driver not found')
    const active = await db.select({ id: deliveryOrders.id }).from(deliveryOrders).where(activeDeliveryOnDriver(id))
    if (active.length > 0) throw conflict('DRIVER_BUSY', 'This driver still has active deliveries')
    await db.delete(drivers).where(eq(drivers.id, id))
    return ok({ id, deleted: true })
  }

  /** Transition a driver's headless state (driver self-service or manager override). */
  static async setStatus(merchantId: string, id: string, nextStatus: string, _actingUserId?: string) {
    const [driver] = await db.select().from(drivers).where(and(eq(drivers.id, id), eq(drivers.merchantId, merchantId)))
    if (!driver) throw notFound('DRIVER_NOT_FOUND', 'Driver not found')
    if (!isDriverStatus(nextStatus)) throw badRequest('INVALID_DRIVER_STATUS', 'Unknown driver status')
    assertDriverTransition(driver.status, nextStatus)
    const [updated] = await db.update(drivers).set({ status: nextStatus }).where(eq(drivers.id, id)).returning()
    return ok(updated)
  }

  static async getByUserId(merchantId: string, userId: string) {
    const driver = await this.findByUser(merchantId, userId)
    if (!driver) throw notFound('DRIVER_NOT_FOUND', 'No driver profile linked to this account')
    return ok(driver)
  }

  /** Record a driver self-reported location heartbeat. */
  static async updateLocation(merchantId: string, userId: string, input: { lat: number; lng: number }) {
    const driver = await this.findByUser(merchantId, userId)
    if (!driver) throw notFound('DRIVER_NOT_FOUND', 'No driver profile linked to this account')
    const [loc] = await db.insert(driverLocations).values({
      merchantId,
      driverId: driver.id,
      lat: input.lat,
      lng: input.lng
    }).returning()
    return ok(loc)
  }
}

/* ------------------------------ delivery orders ------------------------------ */

export class DeliveryOrdersService {
  static async create(
    merchantId: string,
    input: { orderId: string; outletId?: string; zoneId?: string; address?: Address; fee?: number; etaMin?: number; notes?: string }
  ) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')

    const [dup] = await db.select().from(deliveryOrders).where(eq(deliveryOrders.orderId, order.id))
    if (dup) throw conflict('DELIVERY_EXISTS', 'A delivery already exists for this order')

    const outletId = input.outletId ?? order.outletId ?? null
    if (outletId) {
      const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, outletId), eq(outlets.merchantId, merchantId)))
      if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    }

    let zone = null
    if (input.zoneId) {
      const [found] = await db.select().from(deliveryZones).where(and(eq(deliveryZones.id, input.zoneId), eq(deliveryZones.merchantId, merchantId)))
      if (!found) throw notFound('ZONE_NOT_FOUND', 'Delivery zone not found')
      zone = found
    }

    const [row] = await db
      .insert(deliveryOrders)
      .values({
        merchantId,
        orderId: order.id,
        outletId,
        zoneId: zone ? zone.id : null,
        status: 'UNASSIGNED',
        address: input.address ?? order.shippingAddress ?? {},
        fee: input.fee ?? zone?.deliveryFee ?? 0,
        etaMin: input.etaMin ?? zone?.etaMin ?? 30,
        notes: input.notes ?? null
      })
      .returning()
    return this.get(merchantId, row.id)
  }

  static async list(merchantId: string, query: { outletId?: string; status?: string; driverId?: string; search?: string; page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(query)
    const conds = [eq(deliveryOrders.merchantId, merchantId)]
    if (query.outletId) conds.push(eq(deliveryOrders.outletId, query.outletId))
    if (query.status) {
      if (!isDeliveryStatus(query.status)) throw badRequest('INVALID_DELIVERY_STATUS', 'Unknown delivery status')
      conds.push(eq(deliveryOrders.status, query.status))
    }
    if (query.driverId) conds.push(eq(deliveryOrders.assignedDriverId, query.driverId))
    if (query.search) conds.push(eq(orders.orderNumber, query.search.trim()))

    const where = and(...conds)
    const [{ value: total }] = await db.select({ value: count() }).from(deliveryOrders).where(where)
    const rows = await db
      .select({
        id: deliveryOrders.id,
        orderId: deliveryOrders.orderId,
        orderNumber: orders.orderNumber,
        outletId: deliveryOrders.outletId,
        outletName: outlets.name,
        zoneId: deliveryOrders.zoneId,
        status: deliveryOrders.status,
        assignedDriverId: deliveryOrders.assignedDriverId,
        driverName: deliveryOrders.driverName,
        address: deliveryOrders.address,
        fee: deliveryOrders.fee,
        etaMin: deliveryOrders.etaMin,
        pickupAt: deliveryOrders.pickupAt,
        pickedUpAt: deliveryOrders.pickedUpAt,
        arrivedAt: deliveryOrders.arrivedAt,
        deliveredAt: deliveryOrders.deliveredAt,
        cancelledAt: deliveryOrders.cancelledAt,
        notes: deliveryOrders.notes,
        createdAt: deliveryOrders.createdAt
      })
      .from(deliveryOrders)
      .leftJoin(orders, eq(deliveryOrders.orderId, orders.id))
      .leftJoin(outlets, eq(deliveryOrders.outletId, outlets.id))
      .where(where)
      .orderBy(desc(deliveryOrders.createdAt))
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, total) })
  }

  static async get(merchantId: string, id: string) {
    const [joined] = await db
      .select({
        id: deliveryOrders.id,
        orderId: deliveryOrders.orderId,
        orderNumber: orders.orderNumber,
        outletId: deliveryOrders.outletId,
        outletName: outlets.name,
        zoneId: deliveryOrders.zoneId,
        status: deliveryOrders.status,
        assignedDriverId: deliveryOrders.assignedDriverId,
        driverName: deliveryOrders.driverName,
        address: deliveryOrders.address,
        fee: deliveryOrders.fee,
        etaMin: deliveryOrders.etaMin,
        pickupAt: deliveryOrders.pickupAt,
        pickedUpAt: deliveryOrders.pickedUpAt,
        arrivedAt: deliveryOrders.arrivedAt,
        deliveredAt: deliveryOrders.deliveredAt,
        cancelledAt: deliveryOrders.cancelledAt,
        notes: deliveryOrders.notes,
        createdAt: deliveryOrders.createdAt,
        updatedAt: deliveryOrders.updatedAt
      })
      .from(deliveryOrders)
      .leftJoin(orders, eq(deliveryOrders.orderId, orders.id))
      .leftJoin(outlets, eq(deliveryOrders.outletId, outlets.id))
      .where(and(eq(deliveryOrders.id, id), eq(deliveryOrders.merchantId, merchantId)))
    if (!joined) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found')
    return ok(joined)
  }

  /** Eligible drivers for a delivery: ONLINE, correct outlet/zone, not suspended, acceptable workload. */
  private static async eligibleDrivers(merchantId: string, delivery: { id: string; outletId: string | null }) {
    const outletConds = delivery.outletId ? eq(drivers.assignedOutletId, delivery.outletId) : isNull(drivers.assignedOutletId)
    const candidates = await db
      .select()
      .from(drivers)
      .where(
        and(
          eq(drivers.merchantId, merchantId),
          eq(drivers.status, 'ONLINE'),
          notInArray(drivers.status, ['SUSPENDED']),
          outletConds
        )
      )
    const eligible = []
    for (const d of candidates) {
      const active = await db.select({ id: deliveryOrders.id }).from(deliveryOrders).where(activeDeliveryOnDriver(d.id))
      if (active.length === 0) eligible.push(d)
    }
    return eligible
  }

  /** Manual assignment against an eligible driver list (driver must be available). */
  static async assign(merchantId: string, id: string, driverId: string) {
    const [delivery] = await db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.id, id), eq(deliveryOrders.merchantId, merchantId)))
    if (!delivery) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found')
    if (delivery.status !== 'UNASSIGNED') throw conflict('INVALID_TRANSITION', 'Only unassigned deliveries can be assigned')

    const [driver] = await db.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.merchantId, merchantId)))
    if (!driver) throw notFound('DRIVER_NOT_FOUND', 'Driver not found')
    if (driver.status === 'SUSPENDED') throw conflict('DRIVER_UNAVAILABLE', 'Driver is suspended')
    if (driver.status !== 'ONLINE') throw conflict('DRIVER_UNAVAILABLE', 'Driver is not online')

    const active = await db.select({ id: deliveryOrders.id }).from(deliveryOrders).where(activeDeliveryOnDriver(driver.id))
    if (active.length > 0) throw conflict('DRIVER_BUSY', 'This driver already has an active delivery')

    await this._applyAssignment(merchantId, delivery, driver.id, driver.name, 'assign')
    return this.get(merchantId, delivery.id)
  }

  /** Auto-dispatch: pick the first eligible driver for an unassigned delivery. */
  static async autoDispatch(merchantId: string, id: string) {
    const [delivery] = await db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.id, id), eq(deliveryOrders.merchantId, merchantId)))
    if (!delivery) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found')
    if (delivery.status !== 'UNASSIGNED') throw conflict('INVALID_TRANSITION', 'Only unassigned deliveries can be dispatched')

    const eligible = await this.eligibleDrivers(merchantId, delivery)
    if (eligible.length === 0) throw conflict('NO_DRIVERS_AVAILABLE', 'No eligible drivers available for dispatch')

    await this._applyAssignment(merchantId, delivery, eligible[0].id, eligible[0].name, 'auto_dispatch')
    return this.get(merchantId, delivery.id)
  }

  private static async _applyAssignment(
    merchantId: string,
    delivery: { id: string; status: string },
    driverId: string,
    driverName: string,
    reason: 'assign' | 'auto_dispatch'
  ) {
    await db.transaction(async (tx) => {
      await tx.insert(driverAssignments).values({
        merchantId,
        deliveryOrderId: delivery.id,
        driverId,
        driverName,
        reason
      })
      await tx
        .update(deliveryOrders)
        .set({
          status: 'ASSIGNED',
          assignedDriverId: driverId,
          driverName
        })
        .where(eq(deliveryOrders.id, delivery.id))
      await tx.update(drivers).set({ status: 'BUSY' }).where(eq(drivers.id, driverId))
    })
  }

  static async unassign(merchantId: string, id: string) {
    const [delivery] = await db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.id, id), eq(deliveryOrders.merchantId, merchantId)))
    if (!delivery) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found')
    if (!['ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED'].includes(delivery.status)) {
      throw conflict('INVALID_TRANSITION', 'Delivery cannot be unassigned in its current state')
    }

    await db.transaction(async (tx) => {
      await tx
        .update(driverAssignments)
        .set({ unassignedAt: new Date(), reason: 'unassign' })
        .where(and(eq(driverAssignments.deliveryOrderId, delivery.id), isNull(driverAssignments.unassignedAt)))
      await tx
        .update(deliveryOrders)
        .set({
          status: 'UNASSIGNED',
          assignedDriverId: null,
          driverName: null,
          pickedUpAt: null,
          arrivedAt: null,
          deliveredAt: null
        })
        .where(eq(deliveryOrders.id, delivery.id))
      if (delivery.assignedDriverId) {
        await tx.update(drivers).set({ status: 'ONLINE' }).where(eq(drivers.id, delivery.assignedDriverId))
      }
    })
    return this.get(merchantId, delivery.id)
  }

  /** Advance a delivery through the validated lifecycle. */
  static async transition(merchantId: string, id: string, nextStatus: DeliveryStatus) {
    const [delivery] = await db
      .select()
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.id, id), eq(deliveryOrders.merchantId, merchantId)))
    if (!delivery) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found')
    if (!isDeliveryStatus(nextStatus)) throw badRequest('INVALID_DELIVERY_STATUS', 'Unknown delivery status')
    assertDeliveryTransition(delivery.status, nextStatus)

    const timestamps = deliveryTimestampsFor(nextStatus)
    await db.transaction(async (tx) => {
      await tx.update(deliveryOrders).set({ status: nextStatus, ...timestamps }).where(eq(deliveryOrders.id, id))
      if (delivery.assignedDriverId && (nextStatus === 'DELIVERED' || nextStatus === 'FAILED' || nextStatus === 'CANCELLED')) {
        await tx.update(drivers).set({ status: 'ONLINE' }).where(eq(drivers.id, delivery.assignedDriverId))
      }
    })
    return this.get(merchantId, delivery.id)
  }

  /** Deliveries currently assigned to a driver account (driver self-view). */
  static async listForDriver(merchantId: string, userId: string) {
    const driver = await DriversService.findByUser(merchantId, userId)
    if (!driver) throw notFound('DRIVER_NOT_FOUND', 'No driver profile linked to this account')
    return this.list(merchantId, { driverId: driver.id })
  }
}
