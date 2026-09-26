import { and, desc, eq, lte, sql } from 'drizzle-orm'
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
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        trackToken: randomToken(32)
      })
      .returning()
    return ok(row)
  }

  static async send(db: DB, merchantId: string, id: string) {
    const campaign = (await this.get(db, merchantId, id)).data
    if (campaign.status === 'sent') {
      throw badRequest('ALREADY_SENT', 'Campaign has already been sent')
    }

    // Resolve audience: parse segment definition or a direct email list.
    const audience = (campaign.audience as Record<string, unknown>) ?? {}
    const emails = await this.resolveAudience(db, merchantId, audience)

    // Skip opted-out recipients; marketing_opt_out covers campaigns + recovery.
    const recipients = await this.filterOptedOut(db, merchantId, emails)

    const [merchant] = await db
      .select({ name: merchants.name })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
    const storeName = merchant?.name ?? 'Our store'
    const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'
    const trackToken = campaign.trackToken ?? (await this.ensureTrackToken(db, merchantId, id))

    let sent = 0
    for (const email of recipients) {
      try {
        const openPixel = `${process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3005}`}/api/campaigns/track/${trackToken}/open?cid=${encodeURIComponent(email)}`
        const clickUrl = `${process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3005}`}/api/campaigns/track/${trackToken}/click?cid=${encodeURIComponent(email)}&to=${encodeURIComponent(process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479')}`
        const html = renderEmail({
          title: campaign.subject ?? campaign.name,
          intro: campaign.content ?? '',
          storeName,
          cta: { label: 'Shop now', url: clickUrl },
          footerNote: `No longer want these emails? Unsubscribe: ${process.env.PUBLIC_API_URL ?? ''}/api/campaigns/unsubscribe?email=${encodeURIComponent(email)}&mid=${merchantId} — tracking pixel: ${openPixel}`
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
    return ok({ ...updated, skippedOptOut: emails.length - recipients.length })
  }

  /** Ensure a campaign has a track token (backfills rows created before the column). */
  static async ensureTrackToken(db: DB, merchantId: string, id: string): Promise<string> {
    const token = randomToken(32)
    await db
      .update(campaigns)
      .set({ trackToken: token })
      .where(and(eq(campaigns.id, id), eq(campaigns.merchantId, merchantId)))
    return token
  }

  /** Filter an email list down to recipients that have not opted out. */
  static async filterOptedOut(db: DB, merchantId: string, emails: string[]): Promise<string[]> {
    if (emails.length === 0) return []
    const lowered = emails.map((e) => e.toLowerCase())
    const rows = await db
      .select({ email: customers.email, marketingOptOut: customers.marketingOptOut })
      .from(customers)
      .where(eq(customers.merchantId, merchantId))
    const optedOut = new Set(
      rows.filter((r) => r.marketingOptOut).map((r) => r.email.toLowerCase())
    )
    const seen = new Set<string>()
    return lowered.filter((e) => !optedOut.has(e) && !seen.has(e) && (seen.add(e), true))
  }

  /**
   * Scheduled-send worker. Picks up draft/scheduled campaigns whose scheduledAt
   * is due and sends them. Called from runJobWorker (shared/jobs-worker.ts).
   * Returns the number of campaigns sent.
   */
  static async sendDueScheduled(db: DB, batchLimit = 20): Promise<number> {
    const now = new Date()
    const due = await db
      .select({ id: campaigns.id, merchantId: campaigns.merchantId })
      .from(campaigns)
      .where(and(eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledAt, now)))
      .limit(batchLimit)
    let sent = 0
    for (const row of due) {
      try {
        await this.send(db, row.merchantId, row.id)
        sent++
      } catch (e) {
        log.error('scheduled send failed', { campaignId: row.id, error: e })
        await db
          .update(campaigns)
          .set({ status: 'draft' })
          .where(eq(campaigns.id, row.id))
          .catch(() => undefined)
      }
    }
    // Back-compat: drafts with a past scheduledAt are treated as due.
    const overdueDrafts = await db
      .select({ id: campaigns.id, merchantId: campaigns.merchantId })
      .from(campaigns)
      .where(and(eq(campaigns.status, 'draft'), lte(campaigns.scheduledAt, now)))
      .limit(batchLimit)
    for (const row of overdueDrafts) {
      try {
        await this.send(db, row.merchantId, row.id)
        sent++
      } catch (e) {
        log.error('overdue draft send failed', { campaignId: row.id, error: e })
      }
    }
    return sent
  }

  /** Open-pixel tracking: GET /campaigns/track/:token/open (1x1 gif). */
  static async trackOpen(db: DB, trackToken: string, _customerRef?: string) {
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.trackToken, trackToken))
    if (!campaign) throw notFound('CAMPAIGN_NOT_FOUND', 'Unknown tracking token')
    await db
      .update(campaigns)
      .set({ openedCount: sql`${campaigns.openedCount} + 1` })
      .where(eq(campaigns.id, campaign.id))
    return ok({ tracked: true })
  }

  /** Click tracking: GET /campaigns/track/:token/click → 302 to `to`. */
  static async trackClick(db: DB, trackToken: string, _customerRef?: string) {
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.trackToken, trackToken))
    if (!campaign) throw notFound('CAMPAIGN_NOT_FOUND', 'Unknown tracking token')
    await db
      .update(campaigns)
      .set({ clickedCount: sql`${campaigns.clickedCount} + 1` })
      .where(eq(campaigns.id, campaign.id))
    return ok({ tracked: true })
  }

  /* ------------------------------ templates ------------------------------- */

  /**
   * Saved templates are campaigns with status 'template' (no send path touches
   * them). A/B subject testing is intentionally out of scope — templates give
   * merchants reusable content now; automated A/B winner selection is the
   * documented follow-up.
   */
  static async listTemplates(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.merchantId, merchantId), eq(campaigns.status, 'template')))
      .orderBy(desc(campaigns.createdAt))
    return ok({ items: rows })
  }

  static async saveTemplate(
    db: DB,
    merchantId: string,
    input: { name: string; subject?: string; content?: string }
  ) {
    const [row] = await db
      .insert(campaigns)
      .values({
        merchantId,
        name: input.name,
        type: 'email',
        audience: {},
        subject: input.subject ?? null,
        content: input.content ?? null,
        status: 'template',
        trackToken: randomToken(32)
      })
      .returning()
    return ok(row)
  }

  static async createFromTemplate(db: DB, merchantId: string, templateId: string, name: string) {
    const [tpl] = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, templateId),
          eq(campaigns.merchantId, merchantId),
          eq(campaigns.status, 'template')
        )
      )
    if (!tpl) throw notFound('TEMPLATE_NOT_FOUND', 'Template not found')
    return this.create(db, merchantId, {
      name,
      type: tpl.type,
      subject: tpl.subject ?? undefined,
      content: tpl.content ?? undefined,
      audience: (tpl.audience as Record<string, unknown>) ?? {}
    })
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
      scheduledAt?: string | null
      status?: string
    }
  ) {
    const campaign = (await this.get(db, merchantId, id)).data
    if (campaign.status === 'sent') {
      throw badRequest('ALREADY_SENT', 'Sent campaigns cannot be edited')
    }
    if (input.status !== undefined && !['draft', 'scheduled', 'template'].includes(input.status)) {
      throw badRequest('INVALID_STATUS', 'Status must be draft, scheduled or template')
    }
    const [row] = await db
      .update(campaigns)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.audience !== undefined && { audience: input.audience as object }),
        ...(input.triggerType !== undefined && { triggerType: input.triggerType }),
        ...(input.triggerDelayHours !== undefined && { triggerDelayHours: input.triggerDelayHours }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.scheduledAt !== undefined && {
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          // Setting a future scheduledAt moves a draft into the schedule queue.
          ...(input.status === undefined && input.scheduledAt
            ? { status: 'scheduled' as const }
            : {}),
          // Clearing the date pulls a scheduled campaign back to draft.
          ...(input.status === undefined && !input.scheduledAt ? { status: 'draft' as const } : {})
        })
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

  /** Stats snapshot for the dashboard (sent/opened/clicked + opt-out skips). */
  static async stats(db: DB, merchantId: string, id: string) {
    const campaign = (await this.get(db, merchantId, id)).data
    const openRate = campaign.sentCount > 0 ? campaign.openedCount / campaign.sentCount : 0
    const clickRate = campaign.sentCount > 0 ? campaign.clickedCount / campaign.sentCount : 0
    return ok({
      ...campaign,
      openRate: Math.round(openRate * 1000) / 10,
      clickRate: Math.round(clickRate * 1000) / 10
    })
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

const randomToken = (len: number) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => chars[b % chars.length])
    .join('')
}
