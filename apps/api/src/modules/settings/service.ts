import { hash } from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  carriers,
  checkoutSettings,
  codRules,
  merchants,
  notificationSettings,
  paymentProviderConfigs,
  paymentSettings,
  roles,
  shippingSettings,
  storeSettings,
  taxSettings,
  users
} from '../../database/schema'
import { getProvider, listProviders } from '../../payments/registry'
import { decryptJson, encryptJson, isMaskedValue } from '../../shared/crypto'
import { ok } from '../../shared/response'
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors'
import type { ResolvedProviderConfig } from '../../payments/types'
import type { User } from '../../database/schema'
import type { Permission } from '../../shared/types'
import { normalizePermissions } from '../../shared/types'

const upsert = <T extends { merchantId: string }>(
  db: DB,
  table: any,
  merchantId: string,
  values: Omit<T, 'merchantId' | 'updatedAt'>
) =>
  db
    .insert(table)
    .values({ merchantId, ...(values as object) })
    .onConflictDoUpdate({
      target: table.merchantId,
      set: { ...(values as object), updatedAt: new Date() }
    })

export class SettingsService {
  static async getStore(db: DB, merchantId: string) {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId))
    if (!merchant) throw notFound('NOT_FOUND', 'Merchant not found')

    const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.merchantId, merchantId))
    return ok(
      settings ?? {
        merchantId,
        name: merchant.name,
        logo: null,
        address: {},
        currency: merchant.currency,
        timezone: merchant.timezone,
        announcement: ''
      }
    )
  }

  static async updateStore(
    db: DB,
    merchantId: string,
    input: {
      name?: string
      logo?: string
      address?: object
      currency?: string
      timezone?: string
      announcement?: string
    }
  ) {
    const current = await this.getStore(db, merchantId)

    await upsert(db, storeSettings, merchantId, {
      name: input.name ?? current.data.name,
      logo: input.logo ?? current.data.logo,
      address: (input.address as never) ?? current.data.address,
      currency: input.currency ?? current.data.currency,
      timezone: input.timezone ?? current.data.timezone,
      announcement: input.announcement ?? current.data.announcement
    })
    return this.getStore(db, merchantId)
  }

  static async getPayments(db: DB, merchantId: string) {
    const [settings] = await db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.merchantId, merchantId))
    return ok(
      settings ?? {
        merchantId,
        methods: [
          { id: 'card', label: 'Credit / Debit Card', enabled: true },
          { id: 'cod', label: 'Cash on Delivery', enabled: false }
        ],
        currency: 'USD'
      }
    )
  }

  static async updatePayments(
    db: DB,
    merchantId: string,
    input: { methods?: Array<{ id: string; label: string; enabled: boolean }>; currency?: string }
  ) {
    const current = await this.getPayments(db, merchantId)

    await upsert(db, paymentSettings, merchantId, {
      methods: input.methods ?? current.data.methods,
      currency: input.currency ?? current.data.currency
    })
    return this.getPayments(db, merchantId)
  }

  /* ------------------------- payment providers (BYOK) ----------------------- */

  private static async resolveProviderConfig(
    db: DB,
    merchantId: string,
    providerId: string
  ): Promise<{ config: ResolvedProviderConfig } | null> {
    const [row] = await db
      .select()
      .from(paymentProviderConfigs)
      .where(
        and(eq(paymentProviderConfigs.merchantId, merchantId), eq(paymentProviderConfigs.provider, providerId))
      )
    if (!row) return null
    return {
      config: {
        providerId,
        enabled: row.enabled,
        mode: (row.mode === 'live' ? 'live' : 'test') as 'test' | 'live',
        country: row.country ?? null,
        credentials: decryptJson<Record<string, string>>(row.credentials)
      }
    }
  }

  /** Runtime (decrypted) provider config for checkout/webhook flows. */
  static async getEnabledProvider(db: DB, merchantId: string, providerId: string) {
    const resolved = await this.resolveProviderConfig(db, merchantId, providerId)
    if (!resolved || !resolved.config.enabled) throw notFound('PROVIDER_NOT_FOUND', `Payment provider "${providerId}" is not available for this store`)
    return resolved.config
  }

  static async listPaymentProviders(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(paymentProviderConfigs)
      .where(eq(paymentProviderConfigs.merchantId, merchantId))
    const byProvider = new Map(rows.map((r) => [r.provider, r]))

    // Secrets are write-only — never returned to the client.
    return ok(
      listProviders().map((def) => {
        const cfg = byProvider.get(def.id)
        return {
          id: def.id,
          label: def.label,
          description: def.description,
          countries: def.countries,
          currencies: def.currencies,
          credentialFields: def.credentialFields,
          enabled: cfg?.enabled ?? false,
          mode: cfg?.mode ?? 'test',
          country: cfg?.country ?? null,
          configured: !!cfg && Object.keys(cfg.credentials).length > 0,
          updatedAt: cfg?.updatedAt ?? null
        }
      })
    )
  }

  static async updatePaymentProvider(
    db: DB,
    merchantId: string,
    providerId: string,
    input: {
      enabled?: boolean
      mode?: 'test' | 'live'
      country?: string | null
      credentials?: Record<string, string | null>
    }
  ) {
    const adapter = getProvider(providerId)
    if (!adapter) throw notFound('NOT_FOUND', `Unknown payment provider: ${providerId}`)

    const existing = await this.resolveProviderConfig(db, merchantId, providerId)
    const stored = existing ? { ...existing.config.credentials } : {}

    if (input.credentials) {
      for (const [key, value] of Object.entries(input.credentials)) {
        if (typeof value === 'string' && value !== '' && !isMaskedValue(value)) stored[key] = value
        // empty / null / masked values keep whatever is already stored
      }
    }

    const enabled = input.enabled ?? existing?.config.enabled ?? false
    if (enabled) {
      const missing = adapter.def.credentialFields.filter(
        (f) => f.required && !stored[f.key]
      )
      if (missing.length > 0) {
        throw badRequest(
          'BAD_REQUEST',
          `${missing.map((m) => m.label).join(', ')} required to enable ${adapter.def.label}`
        )
      }
    }
    const invalidCountry =
      input.country &&
      adapter.def.countries.length > 0 &&
      !adapter.def.countries.includes(input.country.toUpperCase())
    if (invalidCountry) {
      throw badRequest(
        'BAD_REQUEST',
        `${input.country} is not supported by ${adapter.def.label} (supported: ${adapter.def.countries.join(', ')})`
      )
    }

    await db
      .insert(paymentProviderConfigs)
      .values({
        merchantId,
        provider: providerId,
        enabled,
        mode: input.mode ?? existing?.config.mode ?? 'test',
        country:
          input.country === undefined
            ? (existing?.config.country ?? null)
            : input.country
              ? input.country.toUpperCase()
              : null,
        credentials: encryptJson(stored)
      })
      .onConflictDoUpdate({
        target: [paymentProviderConfigs.merchantId, paymentProviderConfigs.provider],
        set: {
          enabled,
          mode: input.mode ?? existing?.config.mode ?? 'test',
          country:
            input.country === undefined
              ? (existing?.config.country ?? null)
              : input.country
                ? input.country.toUpperCase()
                : null,
          credentials: encryptJson(stored),
          updatedAt: new Date()
        }
      })

    return ok({ providerId, enabled })
  }

  static async testPaymentProvider(db: DB, merchantId: string, providerId: string) {
    const adapter = getProvider(providerId)
    if (!adapter) throw notFound('NOT_FOUND', `Unknown payment provider: ${providerId}`)

    const resolved = await this.resolveProviderConfig(db, merchantId, providerId)
    if (!resolved) {
      throw badRequest('PROVIDER_NOT_CONFIGURED', `${adapter.def.label} has no saved credentials`)
    }
    await adapter.ping(resolved.config)
    return ok({ providerId, status: 'ok' })
  }

  static async getShipping(db: DB, merchantId: string) {
    const [settings] = await db
      .select()
      .from(shippingSettings)
      .where(eq(shippingSettings.merchantId, merchantId))
    return ok(
      settings ?? {
        merchantId,
        zones: [],
        freeShippingThreshold: 0
      }
    )
  }

  static async updateShipping(
    db: DB,
    merchantId: string,
    input: {
      zones?: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>
      freeShippingThreshold?: number
    }
  ) {
    const current = await this.getShipping(db, merchantId)

    await upsert(db, shippingSettings, merchantId, {
      zones: input.zones ?? current.data.zones,
      freeShippingThreshold: input.freeShippingThreshold ?? current.data.freeShippingThreshold
    })
    return this.getShipping(db, merchantId)
  }

  static async getTaxes(db: DB, merchantId: string) {
    const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.merchantId, merchantId))
    return ok(
      settings ?? {
        merchantId,
        autoCalculate: true,
        rates: []
      }
    )
  }

  static async updateTaxes(
    db: DB,
    merchantId: string,
    input: { autoCalculate?: boolean; rates?: Array<{ region: string; rate: number }> }
  ) {
    const current = await this.getTaxes(db, merchantId)

    await upsert(db, taxSettings, merchantId, {
      autoCalculate: input.autoCalculate ?? current.data.autoCalculate,
      rates: input.rates ?? current.data.rates
    })
    return this.getTaxes(db, merchantId)
  }

  /* ----------------------------- notifications ----------------------------- */

  static async getNotifications(db: DB, merchantId: string) {
    const [row] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.merchantId, merchantId))
    return ok(
      row ?? {
        merchantId,
        enabled: true,
        fromName: null,
        fromEmail: null,
        templates: {}
      }
    )
  }

  static async updateNotifications(
    db: DB,
    merchantId: string,
    input: {
      enabled?: boolean
      fromName?: string | null
      fromEmail?: string | null
      templates?: Record<string, boolean>
    }
  ) {
    const current = await this.getNotifications(db, merchantId)

    await upsert(db, notificationSettings, merchantId, {
      enabled: input.enabled ?? current.data.enabled,
      fromName: input.fromName !== undefined ? input.fromName : current.data.fromName,
      fromEmail: input.fromEmail !== undefined ? input.fromEmail : current.data.fromEmail,
      templates: input.templates ?? current.data.templates
    })
    return this.getNotifications(db, merchantId)
  }

  /* --------------------------------- staff -------------------------------- */

  static async listStaff(db: DB, merchantId: string) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        roleId: users.roleId,
        permissions: users.permissions,
        status: users.status,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.merchantId, merchantId))
      .orderBy(users.createdAt)
    return ok(rows)
  }

  /** Validate a roleId belongs to the merchant; returns it when valid. */
  private static async assertRoleInMerchant(db: DB, merchantId: string, roleId: string): Promise<string> {
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.merchantId, merchantId)))
    if (!role) throw badRequest('INVALID_ROLE', 'Role does not belong to this merchant')
    return role.id
  }

  static async createStaff(
    db: DB,
    merchantId: string,
    input: {
      name: string
      email: string
      password: string
      role: string
      permissions?: string[]
      roleId?: string
    }
  ) {
    const email = input.email.toLowerCase()
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.merchantId, merchantId), eq(users.email, email)))
    if (existing) throw conflict('DUPLICATE', 'A staff member with this email already exists')

    const roleId = input.roleId ? await this.assertRoleInMerchant(db, merchantId, input.roleId) : null
    const passwordHash = await hash(input.password, 12)
    const [created] = await db
      .insert(users)
      .values({
        merchantId,
        name: input.name,
        email,
        passwordHash,
        role: input.role,
        permissions: normalizePermissions(input.permissions ?? []) as Permission[],
        roleId,
        status: 'active'
      })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, roleId: users.roleId, permissions: users.permissions, status: users.status, createdAt: users.createdAt })

    return ok(created)
  }

  static async updateStaff(
    db: DB,
    merchantId: string,
    id: string,
    input: {
      name?: string
      email?: string
      password?: string
      role?: string
      permissions?: string[]
      roleId?: string | null
      status?: string
    },
    actor: User
  ) {
    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.merchantId, merchantId)))
    if (!target) throw notFound('NOT_FOUND', 'Staff member not found')

    if (target.role === 'owner') {
      if (input.role !== undefined && input.role !== 'owner') {
        throw badRequest('BAD_REQUEST', 'Cannot change the owner role')
      }
      if (input.status !== undefined && input.status !== 'active') {
        throw badRequest('BAD_REQUEST', 'Cannot disable the owner')
      }
      if (actor.role !== 'owner' && (input.email !== undefined || input.permissions !== undefined)) {
        throw forbidden('Only the owner can change the owner email or permissions')
      }
    }
    if (input.role === 'owner' && actor.role !== 'owner') {
      throw forbidden('Only the owner can grant the owner role')
    }

    const values: Partial<User> = {}
    if (input.name !== undefined) values.name = input.name
    if (input.email !== undefined) values.email = input.email.toLowerCase()
    if (typeof input.password === 'string') values.passwordHash = await hash(input.password, 12)
    if (input.role !== undefined) values.role = input.role
    if (input.permissions !== undefined) values.permissions = normalizePermissions(input.permissions) as Permission[]
    if (input.roleId !== undefined) {
      values.roleId = input.roleId === null ? null : await this.assertRoleInMerchant(db, merchantId, input.roleId)
    }
    if (input.status !== undefined) values.status = input.status

    if (Object.keys(values).length === 0) {
      return ok({
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        permissions: target.permissions,
        status: target.status,
        createdAt: target.createdAt
      })
    }

    const [updated] = await db
      .update(users)
      .set(values)
      .where(and(eq(users.id, id), eq(users.merchantId, merchantId)))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, roleId: users.roleId, permissions: users.permissions, status: users.status, createdAt: users.createdAt })

    return ok(updated)
  }

  static async deleteStaff(db: DB, merchantId: string, id: string, actor: User) {
    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.merchantId, merchantId)))
    if (!target) throw notFound('NOT_FOUND', 'Staff member not found')
    if (target.role === 'owner') throw badRequest('BAD_REQUEST', 'Cannot disable the owner')
    if (target.id === actor.id) throw badRequest('BAD_REQUEST', 'You cannot disable your own account')

    const [updated] = await db
      .update(users)
      .set({ status: 'disabled' })
      .where(and(eq(users.id, id), eq(users.merchantId, merchantId)))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, roleId: users.roleId, permissions: users.permissions, status: users.status, createdAt: users.createdAt })

    return ok(updated)
  }
  /* ----------------------------- COD rules ----------------------------- */

  static async getCodRules(db: DB, merchantId: string) {
    const [row] = await db.select().from(codRules).where(eq(codRules.merchantId, merchantId))
    return ok(
      row ?? {
        merchantId,
        serviceablePincodes: [],
        blacklistPincodes: [],
        minOrderValue: 0,
        maxOrderValue: null,
        codFee: 0,
        enabled: true
      }
    )
  }

  static async updateCodRules(
    db: DB,
    merchantId: string,
    input: {
      serviceablePincodes?: string[]
      blacklistPincodes?: string[]
      minOrderValue?: number
      maxOrderValue?: number
      codFee?: number
      enabled?: boolean
    }
  ) {
    const current = await this.getCodRules(db, merchantId)

    await upsert(db, codRules, merchantId, {
      serviceablePincodes:
        input.serviceablePincodes ?? current.data.serviceablePincodes ?? [],
      blacklistPincodes: input.blacklistPincodes ?? current.data.blacklistPincodes ?? [],
      minOrderValue: input.minOrderValue ?? current.data.minOrderValue ?? 0,
      maxOrderValue:
        input.maxOrderValue !== undefined ? input.maxOrderValue : current.data.maxOrderValue,
      codFee: input.codFee ?? current.data.codFee ?? 0,
      enabled: input.enabled ?? current.data.enabled ?? true
    })
    return this.getCodRules(db, merchantId)
  }

  /* --------------------------- checkout settings --------------------------- */

  static async getCheckoutSettings(db: DB, merchantId: string) {
    const [row] = await db
      .select()
      .from(checkoutSettings)
      .where(eq(checkoutSettings.merchantId, merchantId))
    return ok(
      row ?? {
        merchantId,
        codEnabled: true,
        codMinValue: 0,
        codMaxValue: null,
        codFee: 0,
        serviceablePincodes: [],
        defaultShippingDays: 5
      }
    )
  }

  static async updateCheckoutSettings(
    db: DB,
    merchantId: string,
    input: {
      codEnabled?: boolean
      codMinValue?: number
      codMaxValue?: number
      codFee?: number
      serviceablePincodes?: string[]
      defaultShippingDays?: number
    }
  ) {
    const current = await this.getCheckoutSettings(db, merchantId)

    await upsert(db, checkoutSettings, merchantId, {
      codEnabled: input.codEnabled ?? current.data.codEnabled ?? true,
      codMinValue: input.codMinValue ?? current.data.codMinValue ?? 0,
      codMaxValue:
        input.codMaxValue !== undefined ? input.codMaxValue : current.data.codMaxValue,
      codFee: input.codFee ?? current.data.codFee ?? 0,
      serviceablePincodes:
        input.serviceablePincodes ?? current.data.serviceablePincodes ?? [],
      defaultShippingDays: input.defaultShippingDays ?? current.data.defaultShippingDays ?? 5
    })
    return this.getCheckoutSettings(db, merchantId)
  }

  /* --------------------------- serviceability --------------------------- */

  /**
   * Resolve whether a pincode is serviceable and COD availability.
   * This is the ServiceabilityProvider seam — swap in a real provider later.
   */
  static async checkServiceability(db: DB, merchantId: string, pincode: string) {
    const [checkout] = await db
      .select()
      .from(checkoutSettings)
      .where(eq(checkoutSettings.merchantId, merchantId))
    const [cod] = await db.select().from(codRules).where(eq(codRules.merchantId, merchantId))

    const serviceablePincodes = checkout?.serviceablePincodes ?? []
    const codServiceablePincodes = cod?.serviceablePincodes ?? []
    const codBlacklist = cod?.blacklistPincodes ?? []

    // If no pincodes are configured, everything is serviceable by default.
    const serviceable = serviceablePincodes.length === 0 || serviceablePincodes.includes(pincode)
    const codAvailable =
      serviceable &&
      (codServiceablePincodes.length === 0 || codServiceablePincodes.includes(pincode)) &&
      !codBlacklist.includes(pincode) &&
      (cod?.enabled ?? true)

    return ok({
      pincode,
      serviceable,
      codAvailable,
      estimatedDeliveryDays: checkout?.defaultShippingDays ?? 5,
      shippingFee: serviceable ? (checkout?.codFee ?? 0) : null
    })
  }

  /* ------------------------------ carriers ------------------------------ */

  static async listCarriers(db: DB, merchantId: string) {
    return db.select().from(carriers).where(eq(carriers.merchantId, merchantId))
  }

  static async createCarrier(
    db: DB,
    merchantId: string,
    input: {
      name: string
      code: string
      enabled?: boolean
      credentials?: Record<string, unknown>
      config?: Record<string, unknown>
    }
  ) {
    const [row] = await db
      .insert(carriers)
      .values({
        merchantId,
        name: input.name,
        code: input.code,
        enabled: input.enabled ?? true,
        credentials: input.credentials ?? {},
        config: input.config ?? {}
      })
      .returning()
    return ok(row)
  }

  static async updateCarrier(
    db: DB,
    merchantId: string,
    id: string,
    input: {
      name?: string
      code?: string
      enabled?: boolean
      credentials?: Record<string, unknown>
      config?: Record<string, unknown>
    }
  ) {
    await this.assertCarrierOwned(db, merchantId, id)
    const [row] = await db
      .update(carriers)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.code !== undefined && { code: input.code }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.credentials !== undefined && { credentials: input.credentials }),
        ...(input.config !== undefined && { config: input.config })
      })
      .where(and(eq(carriers.id, id), eq(carriers.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async deleteCarrier(db: DB, merchantId: string, id: string) {
    await this.assertCarrierOwned(db, merchantId, id)
    await db.delete(carriers).where(and(eq(carriers.id, id), eq(carriers.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  private static async assertCarrierOwned(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select({ id: carriers.id })
      .from(carriers)
      .where(and(eq(carriers.id, id), eq(carriers.merchantId, merchantId)))
    if (!row) throw notFound('CARRIER_NOT_FOUND', 'Carrier not found')
    return row
  }

}
