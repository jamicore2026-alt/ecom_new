import { hash } from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  merchants,
  paymentSettings,
  shippingSettings,
  storeSettings,
  taxSettings,
  users
} from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors'
import type { User } from '../../database/schema'
import type { Permission } from '../../shared/types'

const upsert = <T extends { merchantId: string }>(
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
  static async getStore(merchantId: string) {
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
    const current = await this.getStore(merchantId)

    await upsert(storeSettings, merchantId, {
      name: input.name ?? current.data.name,
      logo: input.logo ?? current.data.logo,
      address: (input.address as never) ?? current.data.address,
      currency: input.currency ?? current.data.currency,
      timezone: input.timezone ?? current.data.timezone,
      announcement: input.announcement ?? current.data.announcement
    })
    return this.getStore(merchantId)
  }

  static async getPayments(merchantId: string) {
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
    merchantId: string,
    input: { methods?: Array<{ id: string; label: string; enabled: boolean }>; currency?: string }
  ) {
    const current = await this.getPayments(merchantId)

    await upsert(paymentSettings, merchantId, {
      methods: input.methods ?? current.data.methods,
      currency: input.currency ?? current.data.currency
    })
    return this.getPayments(merchantId)
  }

  static async getShipping(merchantId: string) {
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
    merchantId: string,
    input: {
      zones?: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>
      freeShippingThreshold?: number
    }
  ) {
    const current = await this.getShipping(merchantId)

    await upsert(shippingSettings, merchantId, {
      zones: input.zones ?? current.data.zones,
      freeShippingThreshold: input.freeShippingThreshold ?? current.data.freeShippingThreshold
    })
    return this.getShipping(merchantId)
  }

  static async getTaxes(merchantId: string) {
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
    merchantId: string,
    input: { autoCalculate?: boolean; rates?: Array<{ region: string; rate: number }> }
  ) {
    const current = await this.getTaxes(merchantId)

    await upsert(taxSettings, merchantId, {
      autoCalculate: input.autoCalculate ?? current.data.autoCalculate,
      rates: input.rates ?? current.data.rates
    })
    return this.getTaxes(merchantId)
  }

  /* --------------------------------- staff -------------------------------- */

  static async listStaff(merchantId: string) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        permissions: users.permissions,
        status: users.status,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.merchantId, merchantId))
      .orderBy(users.createdAt)
    return ok(rows)
  }

  static async createStaff(
    merchantId: string,
    input: {
      name: string
      email: string
      password: string
      role: string
      permissions?: string[]
    }
  ) {
    const email = input.email.toLowerCase()
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.merchantId, merchantId), eq(users.email, email)))
    if (existing) throw conflict('DUPLICATE', 'A staff member with this email already exists')

    const passwordHash = await hash(input.password, 10)
    const [created] = await db
      .insert(users)
      .values({
        merchantId,
        name: input.name,
        email,
        passwordHash,
        role: input.role,
        permissions: (input.permissions ?? []) as Permission[],
        status: 'active'
      })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, permissions: users.permissions, status: users.status, createdAt: users.createdAt })

    return ok(created)
  }

  static async updateStaff(
    merchantId: string,
    id: string,
    input: {
      name?: string
      email?: string
      password?: string
      role?: string
      permissions?: string[]
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
    if (input.password !== undefined) values.passwordHash = await hash(input.password, 10)
    if (input.role !== undefined) values.role = input.role
    if (input.permissions !== undefined) values.permissions = input.permissions as Permission[]
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
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, permissions: users.permissions, status: users.status, createdAt: users.createdAt })

    return ok(updated)
  }

  static async deleteStaff(merchantId: string, id: string, actor: User) {
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
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, permissions: users.permissions, status: users.status, createdAt: users.createdAt })

    return ok(updated)
  }
}
