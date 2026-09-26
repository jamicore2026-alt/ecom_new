import { and, desc, eq, lte, max } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { contentPages, contentVersions } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { createLogger } from '../../shared/logger'

const log = createLogger('content')

/** Statuses: draft, scheduled (publishedAt in the future → worker publishes), published, archived. */
const STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const

export class ContentService {
  static async list(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(contentPages)
      .where(eq(contentPages.merchantId, merchantId))
      .orderBy(desc(contentPages.updatedAt))
    return ok({ items: rows })
  }

  static async get(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(contentPages)
      .where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
    if (!row) throw notFound('PAGE_NOT_FOUND', 'Content page not found')
    return ok(row)
  }

  static async getBySlug(db: DB, slugName: string) {
    const [row] = await db
      .select()
      .from(contentPages)
      .where(and(eq(contentPages.slug, slugName), eq(contentPages.status, 'published')))
    if (!row) throw notFound('PAGE_NOT_FOUND', 'Page not found')
    return ok(row)
  }

  static async create(
    db: DB,
    merchantId: string,
    input: { title: string; slug: string; content?: string; status?: string; publishedAt?: string | null }
  ) {
    if (input.status && !(STATUSES as readonly string[]).includes(input.status)) {
      throw badRequest('INVALID_STATUS', 'Status must be draft, scheduled, published or archived')
    }
    const status = input.status ?? 'draft'
    const [row] = await db
      .insert(contentPages)
      .values({
        merchantId,
        title: input.title,
        slug: input.slug,
        content: input.content ?? '',
        status,
        publishedAt:
          status === 'published'
            ? new Date()
            : input.publishedAt
              ? new Date(input.publishedAt)
              : status === 'scheduled'
                ? new Date(Date.now() + 24 * 60 * 60 * 1000)
                : null
      })
      .onConflictDoNothing({ target: [contentPages.merchantId, contentPages.slug] })
      .returning()
    if (!row) throw badRequest('PAGE_EXISTS', 'A page with this slug already exists')
    return ok(row)
  }

  static async update(
    db: DB,
    merchantId: string,
    id: string,
    input: { title?: string; slug?: string; content?: string; status?: string; publishedAt?: string | null; metaTitle?: string; metaDescription?: string },
    actorUserId?: string | null
  ) {
    const current = (await this.get(db, merchantId, id)).data as unknown as Record<string, unknown>
    if (input.status && !(STATUSES as readonly string[]).includes(input.status)) {
      throw badRequest('INVALID_STATUS', 'Status must be draft, scheduled, published or archived')
    }
    const [row] = await db
      .update(contentPages)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.metaTitle !== undefined && { metaTitle: input.metaTitle }),
        ...(input.metaDescription !== undefined && { metaDescription: input.metaDescription }),
        ...(input.status !== undefined && {
          status: input.status,
          publishedAt:
            input.status === 'published'
              ? new Date()
              : input.publishedAt
                ? new Date(input.publishedAt)
                : input.status === 'scheduled'
                  ? new Date(Date.now() + 24 * 60 * 60 * 1000)
                  : null
        }),
        ...(input.status === undefined && input.publishedAt !== undefined && {
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null
        })
      })
      .where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
      .returning()
    // Snapshot the pre-update state as a new version (version+1). Best-effort:
    // a version-write failure must not break the content update itself.
    try {
      const [peak] = await db
        .select({ peak: max(contentVersions.version) })
        .from(contentVersions)
        .where(eq(contentVersions.contentId, id))
      await db.insert(contentVersions).values({
        merchantId,
        contentId: id,
        version: Number(peak?.peak ?? 0) + 1,
        title: String(current.title ?? ''),
        content: String(current.content ?? ''),
        createdBy: actorUserId ?? null
      })
    } catch (e) {
      log.error('content version snapshot failed', { pageId: id, error: e })
    }
    return ok(row)
  }

  /**
   * Scheduled-publish worker: flips 'scheduled' pages whose publishedAt is due
   * to 'published'. Called from runJobWorker (shared/jobs-worker.ts).
   */
  static async publishDue(db: DB, batchLimit = 50): Promise<number> {
    const now = new Date()
    const due = await db
      .select({ id: contentPages.id, merchantId: contentPages.merchantId })
      .from(contentPages)
      .where(and(eq(contentPages.status, 'scheduled'), lte(contentPages.publishedAt, now)))
      .limit(batchLimit)
    for (const row of due) {
      try {
        await db
          .update(contentPages)
          .set({ status: 'published', publishedAt: now })
          .where(and(eq(contentPages.id, row.id), eq(contentPages.merchantId, row.merchantId)))
      } catch (e) {
        log.error('scheduled publish failed', { pageId: row.id, error: e })
      }
    }
    return due.length
  }

  static async delete(db: DB, merchantId: string, id: string) {
    await this.get(db, merchantId, id)
    await db
      .delete(contentPages)
      .where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  /** Version history for a page (ascending version order). */
  static async listVersions(db: DB, merchantId: string, id: string) {
    await this.get(db, merchantId, id)
    const rows = await db
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.contentId, id), eq(contentVersions.merchantId, merchantId)))
      .orderBy(desc(contentVersions.version))
    return ok({ items: rows })
  }

  /**
   * Rollback: restore a historic version's title/content as a NEW page update
   * (which itself snapshots the pre-rollback state first, so rollback is
   * undoable). Slug/status/meta are intentionally left untouched.
   */
  static async rollback(
    db: DB,
    merchantId: string,
    id: string,
    version: number,
    actorUserId?: string | null
  ) {
    const [snapshot] = await db
      .select()
      .from(contentVersions)
      .where(
        and(
          eq(contentVersions.contentId, id),
          eq(contentVersions.merchantId, merchantId),
          eq(contentVersions.version, version)
        )
      )
    if (!snapshot) throw notFound('VERSION_NOT_FOUND', 'Content version not found')
    return this.update(
      db,
      merchantId,
      id,
      { title: snapshot.title, content: snapshot.content ?? '' },
      actorUserId
    )
  }
}
