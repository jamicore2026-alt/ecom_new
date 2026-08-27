import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { contentPages } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'

export class ContentService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(contentPages)
      .where(eq(contentPages.merchantId, merchantId))
      .orderBy(desc(contentPages.updatedAt))
    return ok({ items: rows })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(contentPages)
      .where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
    if (!row) throw notFound('PAGE_NOT_FOUND', 'Content page not found')
    return ok(row)
  }

  static async getBySlug(slugName: string) {
    const [row] = await db
      .select()
      .from(contentPages)
      .where(and(eq(contentPages.slug, slugName), eq(contentPages.status, 'published')))
    if (!row) throw notFound('PAGE_NOT_FOUND', 'Page not found')
    return ok(row)
  }

  static async create(
    merchantId: string,
    input: { title: string; slug: string; content?: string; status?: string }
  ) {
    const [row] = await db
      .insert(contentPages)
      .values({
        merchantId,
        title: input.title,
        slug: input.slug,
        content: input.content ?? '',
        status: input.status ?? 'draft',
        publishedAt: input.status === 'published' ? new Date() : null
      })
      .onConflictDoNothing({ target: [contentPages.merchantId, contentPages.slug] })
      .returning()
    if (!row) throw badRequest('PAGE_EXISTS', 'A page with this slug already exists')
    return ok(row)
  }

  static async update(
    merchantId: string,
    id: string,
    input: { title?: string; slug?: string; content?: string; status?: string; metaTitle?: string; metaDescription?: string }
  ) {
    await this.get(merchantId, id)
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
          publishedAt: input.status === 'published' ? new Date() : null
        })
      })
      .where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async delete(merchantId: string, id: string) {
    await this.get(merchantId, id)
    await db
      .delete(contentPages)
      .where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
    return ok({ deleted: true })
  }
}
