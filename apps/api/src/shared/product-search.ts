import { ilike, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { products } from '../database/schema'

/** Escape LIKE metacharacters so user input can't inject % / _ wildcards. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Hybrid product search condition: indexed tsvector match (word-level, ranked)
 * plus ILIKE substring fallback so partial words / SKUs still hit.
 */
export function productSearchCondition(term: string): SQL | undefined {
  const q = term.trim()
  if (!q) return undefined
  const like = `%${escapeLike(q)}%`
  return or(
    sql`${products.searchVector} @@ websearch_to_tsquery('english', ${q})`,
    ilike(products.name, like),
    ilike(products.sku, like)
  )
}

/** Relevance score for ordering search results (higher = better match). */
export function productSearchRank(term: string): SQL {
  return sql`ts_rank(${products.searchVector}, websearch_to_tsquery('english', ${term.trim()}))`
}
