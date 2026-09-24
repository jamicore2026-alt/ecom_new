import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { campaigns, customers, customerSegments, customerTags, merchants } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { createLogger } from '../../shared/logger'
import { SegmentsService, type SegmentDefinition } from '../segments/service'

export type CampaignAudience =
  | { type: 'all' }
  | { type: 'segment'; segmentId: string }
  | { type: 'tag'; tag: string }
  | { type: 'list'; emails: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmails(raw: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const email = item.trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

const log = createLogger('campaigns')
import { getMailer, renderEmail } from '../../shared/mailer'

export class CampaignsService {
  static async list(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.merchantId, merchantId))
      .orderBy(desc(campaigns.createdAt))
    return ok({ items: rows })
  }

  static async get(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
    if (!row) throw notFound('CAMPAIGN_NOT_FOUND', 'Campaign not found')
    return ok(row)
  }

  static async create(
    db: DB,
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

  static async send(db: DB, merchantId: string, id: string) {
    const campaign = (await this.get(db, merchantId, id)).data

    // Resolve audience: parse segment definition or a direct email list.
    const audience = (campaign.audience as Record<string, unknown>) ?? {}
    const emails = await this.resolveAudience(db, merchantId, audience)

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
        log.error('send failed', { email, error: e })
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
    db: DB,
    merchantId: string,
    id: string,
    input: {
      name?: string
      subject?: string
      content?: string
      audience?: Record<string, unknown>
      triggerType?: string
      triggerDelayHours?: number
      scheduledAt?: string
    }
  ) {
    await this.get(db, merchantId, id)
    const [row] = await db
      .update(campaigns)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.audience !== undefined && { audience: input.audience as object }),
        ...(input.triggerType !== undefined && { triggerType: input.triggerType }),
        ...(input.triggerDelayHours !== undefined && { triggerDelayHours: input.triggerDelayHours }),
        ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null })
      })
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async delete(db: DB, merchantId: string, id: string) {
    await this.get(db, merchantId, id)
    await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  /**
   * Resolve a campaign audience descriptor to a deduped, validated email list.
   * Supported shapes:
   * - { type: 'all' } (default when missing/empty) — all customer emails
   * - { type: 'segment', segmentId } — live members via SegmentsService.listMembers
   * - { type: 'tag', tag } — customers carrying the tag (tags column or customer_tags)
   * - { type: 'list', emails } — explicit email list
   */
  static async resolveAudience(
    db: DB,
    merchantId: string,
    audience: Record<string, unknown> | CampaignAudience | null | undefined
  ): Promise<string[]> {
    const a = (audience ?? {}) as Record<string, unknown>
    const type = typeof a.type === 'string' ? a.type : 'all'

    if (type === 'all') {
      const all = await db
        .select({ email: customers.email })
        .from(customers)
        .where(eq(customers.merchantId, merchantId))
      return normalizeEmails(all.map((c) => c.email))
    }

    if (type === 'segment') {
      const segmentId = a.segmentId
      if (typeof segmentId !== 'string' || !segmentId) {
        throw badRequest('INVALID_AUDIENCE', 'Segment audience requires a segmentId')
      }
      const [segment] = await db
        .select()
        .from(customerSegments)
        .where(and(eq(customerSegments.id, segmentId), eq(customerSegments.merchantId, merchantId)))
      if (!segment) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found')
      const members = await SegmentsService.listMembers(
        db,
        merchantId,
        (segment.definition ?? {}) as SegmentDefinition
      )
      return normalizeEmails(members.map((m) => m.email))
    }

    if (type === 'tag') {
      const tag = a.tag
      if (typeof tag !== 'string' || !tag.trim()) {
        throw badRequest('INVALID_AUDIENCE', 'Tag audience requires a tag')
      }
      const wanted = tag.trim()
      const [rows, tagged] = await Promise.all([
        db
          .select({ id: customers.id, email: customers.email, tags: customers.tags })
          .from(customers)
          .where(eq(customers.merchantId, merchantId)),
        db
          .select({ customerId: customerTags.customerId })
          .from(customerTags)
          .where(and(eq(customerTags.merchantId, merchantId), eq(customerTags.tag, wanted)))
      ])
      const taggedIds = new Set(tagged.map((t) => t.customerId))
      const emails = rows
        .filter((c) => (Array.isArray(c.tags) && c.tags.includes(wanted)) || taggedIds.has(c.id))
        .map((c) => c.email)
      return normalizeEmails(emails)
    }

    if (type === 'list') {
      const emails = a.emails
      if (!Array.isArray(emails)) {
        throw badRequest('INVALID_AUDIENCE', 'List audience requires an emails array')
      }
      return normalizeEmails(emails)
    }

    throw badRequest('INVALID_AUDIENCE', `Unknown audience type: ${type}`)
  }
}
