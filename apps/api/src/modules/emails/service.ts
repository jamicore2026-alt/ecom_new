import { eq } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  customers,
  emailLogs,
  merchants,
  notificationSettings,
  orderItems,
  orders,
  storeSettings,
  type EmailTemplateId,
  type Order
} from '../../database/schema'
import { getMailer, renderEmail } from '../../shared/mailer'
import { currencyDecimals, roundForCurrency } from '../../shared/currency'

const FALLBACK_FROM_EMAIL = () => process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'

interface Identity {
  storeName: string
  from: string
}

export class EmailsService {
  /* ------------------------------ settings ------------------------------- */

  private static async identity(merchantId: string): Promise<Identity | null> {
    const [row] = await db
      .select({
        settings: notificationSettings,
        merchantName: merchants.name,
        storeName: storeSettings.name
      })
      .from(merchants)
      .leftJoin(notificationSettings, eq(notificationSettings.merchantId, merchants.id))
      .leftJoin(storeSettings, eq(storeSettings.merchantId, merchants.id))
      .where(eq(merchants.id, merchantId))
    if (!row) return null
    if (row.settings && !row.settings.enabled) return null
    const storeName = row.settings?.fromName ?? row.storeName ?? row.merchantName
    const fromEmail = row.settings?.fromEmail ?? FALLBACK_FROM_EMAIL()
    return { storeName, from: `${storeName} <${fromEmail}>` }
  }

  private static templateEnabled(
    templates: Record<string, boolean> | undefined,
    template: EmailTemplateId
  ): boolean {
    return templates?.[template] !== false
  }

  private static formatMoney(amount: number, currency: string): string {
    const decimals = currencyDecimals(currency)
    const rounded = roundForCurrency(amount, currency)
    return `${currency} ${rounded.toFixed(decimals)}`
  }

  /* -------------------------------- sending ------------------------------ */

  /** Queues a transactional email. Never throws — notifications must not break checkout. */
  static async queue(input: {
    merchantId: string
    orderId?: string | null
    to: string
    template: EmailTemplateId
    subject: string
    html: string
  }): Promise<void> {
    try {
      const identity = await this.identity(input.merchantId)
      if (!identity) return
      const [settingsRow] = await db
        .select({ templates: notificationSettings.templates })
        .from(notificationSettings)
        .where(eq(notificationSettings.merchantId, input.merchantId))
      if (!this.templateEnabled(settingsRow?.templates, input.template)) return

      const [log] = await db
        .insert(emailLogs)
        .values({
          merchantId: input.merchantId,
          orderId: input.orderId ?? null,
          toEmail: input.to,
          template: input.template,
          subject: input.subject
        })
        .returning()

      // Fire-and-forget delivery — the response has already been sent.
      void this.deliver(log.id, {
        from: identity.from,
        to: input.to,
        subject: input.subject,
        html: input.html
      })
    } catch (e) {
      console.error('[emails] queue failed:', e)
    }
  }

  private static async deliver(logId: string, input: Parameters<ReturnType<typeof getMailer>['send']>[0]) {
    try {
      const result = await getMailer().send(input)
      await db
        .update(emailLogs)
        .set(
          result.ok && result.id === 'noop'
            ? // No real provider configured — never claim a delivery that didn't happen.
              { status: 'skipped', providerRef: 'noop' }
            : result.ok
              ? { status: 'sent', providerRef: result.id ?? null, sentAt: new Date() }
              : { status: 'failed', error: result.error ?? 'Unknown mailer error' }
        )
        .where(eq(emailLogs.id, logId))
    } catch (e) {
      console.error('[emails] deliver failed:', e)
      await db
        .update(emailLogs)
        .set({ status: 'failed', error: e instanceof Error ? e.message : 'Delivery crashed' })
        .where(eq(emailLogs.id, logId))
        .catch(() => undefined)
    }
  }

  /* --------------------------- shopper auth emails ----------------------- */

  /**
   * Queues a password-reset or email-verification email for a shopper.
   * Fire-and-forget via queue(); never throws. Builds the CTA link and honors
   * the merchant's notification settings + from-name/from-email identity.
   */
  static async shopperAuthEmail(
    merchantId: string,
    input: {
      to: string
      kind: 'reset_password' | 'email_verification'
      token: string
      slug?: string
    }
  ): Promise<void> {
    const title =
      input.kind === 'reset_password' ? 'Reset your password' : 'Verify your email'
    const url = input.slug
      ? `${process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'}/${input.slug}/account?verify=${encodeURIComponent(input.token)}`
      : `${process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'}/account?reset=${encodeURIComponent(input.token)}`

    await this.queue({
      merchantId,
      to: input.to,
      template: input.kind,
      subject: input.kind === 'reset_password' ? 'Reset your password' : 'Verify your email address',
      html: renderEmail({
        title,
        intro:
          input.kind === 'reset_password'
            ? 'We received a request to reset your password. Click below to set a new one. If you did not request this, you can safely ignore this email.'
            : 'Confirm that this is your email address to keep your account secure.',
        storeName: (await this.identity(merchantId))?.storeName ?? 'Our store',
        cta: {
          label: input.kind === 'reset_password' ? 'Reset password' : 'Verify email',
          url
        }
      })
    })
  }

  /* ------------------------------- triggers ------------------------------ */

  private static async recipientFor(order: Order): Promise<string | null> {
    if (!order.customerId) return null
    const [customer] = await db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, order.customerId))
    return customer?.email ?? null
  }

  private static async itemsFor(orderId: string) {
    return db
      .select({ name: orderItems.name, quantity: orderItems.quantity, total: orderItems.total })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
  }

  static async orderPlaced(order: Order): Promise<void> {
    try {
      const identity = await this.identity(order.merchantId)
      const to = await this.recipientFor(order)
      if (!identity || !to) return
      const items = await this.itemsFor(order.id)
      const paid = order.paymentStatus === 'paid'
      const total = this.formatMoney(Number(order.total), order.currency)
      await this.queue({
        merchantId: order.merchantId,
        orderId: order.id,
        to,
        template: 'order_placed',
        subject: `Your ${identity.storeName} order ${order.orderNumber} is confirmed`,
        html: renderEmail({
          title: `Order ${order.orderNumber} confirmed`,
          intro: paid
            ? 'Thanks for your purchase! Your order and payment have been received.'
            : 'Thanks for your order! We are waiting for your payment to be completed.',
          storeName: identity.storeName,
          items: items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            total: this.formatMoney(Number(i.total), order.currency)
          })),
          lines: [
            { label: 'Payment', value: paid ? 'Paid' : 'Awaiting payment' },
            ...(items.length ? [] : [{ label: 'Total', value: total }])
          ],
          total: items.length ? total : undefined
        })
      })
    } catch (e) {
      console.error('[emails] orderPlaced failed:', e)
    }
  }

  static async orderPaid(merchantId: string, orderId: string): Promise<void> {
    try {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
      if (!order) return
      const identity = await this.identity(merchantId)
      const to = await this.recipientFor(order)
      if (!identity || !to) return
      await this.queue({
        merchantId,
        orderId,
        to,
        template: 'order_paid',
        subject: `Payment received for ${identity.storeName} order ${order.orderNumber}`,
        html: renderEmail({
          title: 'Payment confirmed',
          intro: `We received your payment of ${this.formatMoney(Number(order.total), order.currency)} for order ${order.orderNumber}. It is now being prepared.`,
          storeName: identity.storeName,
          lines: [
            { label: 'Order', value: order.orderNumber },
            { label: 'Amount', value: this.formatMoney(Number(order.total), order.currency) }
          ]
        })
      })
    } catch (e) {
      console.error('[emails] orderPaid failed:', e)
    }
  }

  static async refundProcessed(merchantId: string, orderId: string, amount: number): Promise<void> {
    try {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
      if (!order) return
      const identity = await this.identity(merchantId)
      const to = await this.recipientFor(order)
      if (!identity || !to) return
      await this.queue({
        merchantId,
        orderId,
        to,
        template: 'refund_processed',
        subject: `Refund processed for ${identity.storeName} order ${order.orderNumber}`,
        html: renderEmail({
          title: 'Refund processed',
          intro: `A refund of ${this.formatMoney(amount, order.currency)} for order ${order.orderNumber} has been processed. It may take a few business days to appear on your statement.`,
          storeName: identity.storeName,
          lines: [
            { label: 'Order', value: order.orderNumber },
            { label: 'Refund amount', value: this.formatMoney(amount, order.currency) }
          ]
        })
      })
    } catch (e) {
      console.error('[emails] refundProcessed failed:', e)
    }
  }
}
