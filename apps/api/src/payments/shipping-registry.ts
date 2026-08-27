import type { ShippingProvider } from '../shared/shipping-provider'

/**
 * Courier provider registry — mirrors payments/registry.ts.
 * Register new providers here without touching order/fulfillment logic.
 */
class ShippingRegistry {
  private providers = new Map<string, ShippingProvider>()

  register(provider: ShippingProvider): void {
    this.providers.set(provider.name, provider)
  }

  getProvider(name: string): ShippingProvider | undefined {
    return this.providers.get(name)
  }

  listProviders(): ShippingProvider[] {
    return [...this.providers.values()]
  }
}

export const shippingRegistry = new ShippingRegistry()

// Register a built-in "manual" provider that just marks the shipment created
// locally without a gateway call. Real couriers plug in here later.
shippingRegistry.register({
  name: 'manual',
  async createShipment() {
    return { externalShipmentId: `manual-${Date.now()}` }
  },
  async cancelShipment() {},
  async getTracking() {
    return { status: 'unknown', events: [] }
  },
  async generateLabel() {
    return {}
  }
})

export const getShippingProvider = (name: string): ShippingProvider | undefined =>
  shippingRegistry.getProvider(name)
export const listShippingProviders = (): ShippingProvider[] => shippingRegistry.listProviders()
