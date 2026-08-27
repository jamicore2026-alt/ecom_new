/**
 * Courier/Shipping provider abstraction.
 *
 * Implement this interface per provider (Shiprocket, Delhivery, Printful,
 * UberFreight, etc.). The order/fulfillment logic depends only on this
 * interface — never on a specific courier's API.
 */
export interface ShippingProvider {
  readonly name: string
  /** Create a shipment and return tracking/label details. */
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>
  /** Cancel an existing shipment by external id. */
  cancelShipment(externalShipmentId: string): Promise<void>
  /** Get live tracking status from provider. */
  getTracking(externalShipmentId: string): Promise<ShipmentTracking>
  /** Generate a shipping label for a fulfillment. */
  generateLabel(input: GenerateLabelInput): Promise<{ labelUrl?: string; labelBase64?: string }>
}

export interface CreateShipmentInput {
  merchantId: string
  orderNumber: string
  address: {
    name?: string
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
    phone?: string
  }
  items: Array<{
    sku?: string
    name: string
    quantity: number
    weight?: number
  }>
  courier?: string
}

export interface CreateShipmentResult {
  externalShipmentId: string
  trackingNumber?: string
  trackingUrl?: string
  labelUrl?: string
  status?: string
}

export interface ShipmentTracking {
  status: string
  events: Array<{ time: string; location: string; description: string }>
}

export interface GenerateLabelInput {
  externalShipmentId?: string
  address?: Record<string, unknown>
}
