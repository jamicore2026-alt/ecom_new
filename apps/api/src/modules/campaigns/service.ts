import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { campaigns, customers, merchants } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
import { getMailer, renderEmail } from '../../shared/mailer'

export class CampaignsService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.merchantId, merchantId))
      .orderBy(desc(campaigns.createdAt))
    return ok({ items: rows })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
    if (!row) throw notFound('CAMPAIGN_NOT_FOUND', 'Campaign not found')
    return ok(row)
  }

  static async create(
    merchantId: string,
    input: {
      name: string
      type?: string
      audience?: Record<string, unknown>
      subject?: string
      content?: string
      triggerType?: string
      triggerDelayHours?: number
      scheduledAt?: string
    }
  ) {
    const [row] = await db
      .insert(campaigns)
      .values({
        merchantId,
        name: input.name,
        type: input.type ?? 'email',
        audience: (input.audience as object) ?? {},
        subject: input.subject ?? null,
        content: input.content ?? null,
        triggerType: input.triggerType ?? null,
        triggerDelayHours: input.triggerDelayHours ?? 0,
        status: 'draft',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null
      })
      .returning()
    return ok(row)
  }

  static async send(merchantId: string, id: string) {
    const campaign = (await this.get(merchantId, id)).data

    // Resolve audience: parse segment definition or a direct email list.
    const audience = (campaign.audience as Record<string, unknown>) ?? {}
    const emails = await this.resolveAudience(merchantId, audience)

    const [merchant] = await db
      .select({ name: merchants.name })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
    const storeName = merchant?.name ?? 'Our store'
    const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'

    let sent = 0
    for (const email of emails) {
      try {
        const html = renderEmail({
          title: campaign.subject ?? campaign.name,
          intro: campaign.content ?? '',
          storeName,
          cta: { label: 'Shop now', url: `${process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'}` }
        })
        await getMailer().send({
          from: `${storeName} <${fromEmail}>`,
          to: email,
          subject: campaign.subject ?? campaign.name,
          html
        })
        sent++
      } catch (e) {
        console.error('[campaigns] send failed for', email, e)
      }
    }

    const [updated] = await db
      .update(campaigns)
      .set({ status: 'sent', sentCount: sent, sentAt: new Date() })
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  static async update(
    merchantId: string,
    id: string,
    input: {
      name?: string
      subject?: string
      content?: string
      triggerType?: string
      triggerDelayHours?: number
      scheduledAt?: string
    }
  ) {
    await this.get(merchantId, id)
    const [row] = await db
      .update(campaigns)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.triggerType !== undefined && { triggerType: input.triggerType }),
        ...(input.triggerDelayHours !== undefined && { triggerDelayHours: input.triggerDelayHours }),
        ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null })
      })
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async delete(merchantId: string, id: string) {
    await this.get(merchantId, id)
    await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  private static async resolveAudience(merchantId: string, audience: Record<string, unknown>) {
    const all = await db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.merchantId, merchantId))
    return all.map((c) => c.email).filter(Boolean) as string[]
  }
}
