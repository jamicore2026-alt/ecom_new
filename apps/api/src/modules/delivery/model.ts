import { t } from 'elysia'
import {
  DELIVERY_STATUSES,
  DELIVERY_ZONE_STATUSES,
  DRIVER_STATUSES
} from '../../shared/types'

const deliveryStatusEnum = Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, s]))
const zoneStatusEnum = Object.fromEntries(DELIVERY_ZONE_STATUSES.map((s) => [s, s]))
const driverStatusEnum = Object.fromEntries(DRIVER_STATUSES.map((s) => [s, s]))

export const deliveryParams = t.Object({ id: t.String() })

export const deliveryZoneBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  outletId: t.Optional(t.String()),
  centerLat: t.Number(),
  centerLng: t.Number(),
  radiusKm: t.Optional(t.Number({ minimum: 0 })),
  deliveryFee: t.Optional(t.Number({ minimum: 0 })),
  minOrder: t.Optional(t.Number({ minimum: 0 })),
  freeDeliveryThreshold: t.Optional(t.Number({ minimum: 0 })),
  etaMin: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
  status: t.Optional(t.Enum(zoneStatusEnum))
})
export const deliveryZoneUpdateBody = t.Partial(deliveryZoneBody)
export const deliveryZoneQuery = t.Object({ outletId: t.Optional(t.String()) })

export const driverBody = t.Object({
  userId: t.String(),
  name: t.String({ minLength: 1, maxLength: 255 }),
  phone: t.Optional(t.String()),
  email: t.Optional(t.String()),
  vehicleType: t.Optional(t.String()),
  vehiclePlate: t.Optional(t.String()),
  assignedOutletId: t.Optional(t.String())
})
export const driverUpdateBody = t.Partial(driverBody)
export const driverQuery = t.Object({
  outletId: t.Optional(t.String()),
  status: t.Optional(t.String()),
  search: t.Optional(t.String()),
  page: t.Optional(t.Number()),
  limit: t.Optional(t.Number())
})

export const deliveryQuery = t.Object({
  outletId: t.Optional(t.String()),
  status: t.Optional(t.String()),
  driverId: t.Optional(t.String()),
  search: t.Optional(t.String()),
  page: t.Optional(t.Number()),
  limit: t.Optional(t.Number())
})

export const deliveryAddressSchema = t.Object({
  name: t.Optional(t.String({ maxLength: 255 })),
  line1: t.Optional(t.String({ maxLength: 500 })),
  line2: t.Optional(t.String({ maxLength: 500 })),
  city: t.Optional(t.String({ maxLength: 120 })),
  state: t.Optional(t.String({ maxLength: 120 })),
  postalCode: t.Optional(t.String({ maxLength: 30 })),
  country: t.Optional(t.String({ maxLength: 2 })),
  phone: t.Optional(t.String({ maxLength: 50 })),
  lat: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
  lng: t.Optional(t.Number({ minimum: -180, maximum: 180 }))
})

export const deliveryCreateBody = t.Object({
  orderId: t.String(),
  outletId: t.Optional(t.String()),
  zoneId: t.Optional(t.String()),
  address: t.Optional(deliveryAddressSchema),
  fee: t.Optional(t.Number({ minimum: 0 })),
  etaMin: t.Optional(t.Number({ minimum: 1 })),
  notes: t.Optional(t.String())
})

export const deliveryAssignBody = t.Object({ driverId: t.String() })
export const deliveryTransitionBody = t.Object({ status: t.Enum(deliveryStatusEnum) })
export const driverTransitionBody = t.Object({ status: t.Enum(driverStatusEnum) })

export const deliveryTrackingBody = t.Object({
  trackingUrl: t.String({ minLength: 10, maxLength: 1024 })
})
export const deliveryPodBody = t.Object({
  note: t.Optional(t.String({ maxLength: 1000 })),
  photoUrl: t.Optional(t.String({ maxLength: 1024 })),
  signature: t.Optional(t.String({ maxLength: 255 }))
})
const failReasonEnum = Object.fromEntries(
  ['no_answer', 'wrong_address', 'refused', 'cancelled', 'other'].map((r) => [r, r])
)
export const deliveryFailBody = t.Object({
  reason: t.Enum(failReasonEnum),
  note: t.Optional(t.String({ maxLength: 1000 }))
})

export const driverMeBody = t.Object({
  status: t.Optional(t.Enum(driverStatusEnum)),
  lat: t.Optional(t.Number()),
  lng: t.Optional(t.Number())
})
