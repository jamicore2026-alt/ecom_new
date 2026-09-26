import { desc, eq, max } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { themeConfigs, themeVersions } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { createLogger } from '../../shared/logger'

const log = createLogger('theme')

/** Strict 6-digit hex color (`#rrggbb`, case-insensitive). */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Logo allowlist: http(s) URLs only. Rejects `javascript:`, `data:` and any
 * other non-http(s) scheme so a stored logo can never become an XSS vector
 * when rendered into the storefront / dashboard.
 */
export const assertLogoUrl = (logo: string | null | undefined): void => {
  if (logo === null || logo === undefined || logo === '') return
  if (logo.length > 1024) throw badRequest('INVALID_LOGO', 'Logo URL must be ≤ 1024 characters')
  let parsed: URL
  try {
    parsed = new URL(logo)
  } catch {
    throw badRequest('INVALID_LOGO', 'Logo must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('INVALID_LOGO', 'Logo must be an http(s) URL (javascript:/data: rejected)')
  }
}

export const assertHexColor = (value: string | undefined, field: string): void => {
  if (value === undefined) return
  if (!HEX_COLOR_RE.test(value)) {
    throw badRequest('INVALID_COLOR', `${field} must be a hex color like #4f46e5`)
  }
}

export class ThemeService {
  static async get(db: DB, merchantId: string) {
    const [row] = await db
      .select()
      .from(themeConfigs)
      .where(eq(themeConfigs.merchantId, merchantId))
    return ok(
      row ?? {
        merchantId,
        primaryColor: '#4f46e5',
        secondaryColor: '#6b7280',
        accentColor: '#f59e0b',
        logo: null,
        typography: {},
        header: {},
        footer: {},
        config: {}
      }
    )
  }

  static async update(
    db: DB,
    merchantId: string,
    input: {
      primaryColor?: string
      secondaryColor?: string
      accentColor?: string
      logo?: string | null
      typography?: Record<string, unknown>
      header?: Record<string, unknown>
      footer?: Record<string, unknown>
      config?: Record<string, unknown>
      note?: string
    },
    actorUserId?: string | null
  ) {
    assertHexColor(input.primaryColor, 'primaryColor')
    assertHexColor(input.secondaryColor, 'secondaryColor')
    assertHexColor(input.accentColor, 'accentColor')
    assertLogoUrl(input.logo)
    const current = await this.get(db, merchantId)
    await db
      .insert(themeConfigs)
      .values({
        merchantId,
        primaryColor: input.primaryColor ?? (current.data as any).primaryColor ?? '#4f46e5',
        secondaryColor: input.secondaryColor ?? (current.data as any).secondaryColor ?? '#6b7280',
        accentColor: input.accentColor ?? (current.data as any).accentColor ?? '#f59e0b',
        logo: input.logo !== undefined ? input.logo : (current.data as any).logo,
        typography: (input.typography as object) ?? (current.data as any).typography ?? {},
        header: (input.header as object) ?? (current.data as any).header ?? {},
        footer: (input.footer as object) ?? (current.data as any).footer ?? {},
        config: (input.config as object) ?? (current.data as any).config ?? {}
      })
      .onConflictDoUpdate({
        target: themeConfigs.merchantId,
        set: {
          primaryColor: input.primaryColor ?? (current.data as any).primaryColor ?? '#4f46e5',
          secondaryColor: input.secondaryColor ?? (current.data as any).secondaryColor ?? '#6b7280',
          accentColor: input.accentColor ?? (current.data as any).accentColor ?? '#f59e0b',
          logo: input.logo !== undefined ? input.logo : (current.data as any).logo,
          typography: (input.typography as object) ?? (current.data as any).typography ?? {},
          header: (input.header as object) ?? (current.data as any).header ?? {},
          footer: (input.footer as object) ?? (current.data as any).footer ?? {},
          config: (input.config as object) ?? (current.data as any).config ?? {},
          updatedAt: new Date()
        }
      })
    // Snapshot the previous full theme document as a new version (version+1).
    // Best-effort: version failure never blocks the theme update itself.
    try {
      const prev = current.data as Record<string, unknown>
      const [peak] = await db
        .select({ peak: max(themeVersions.version) })
        .from(themeVersions)
        .where(eq(themeVersions.merchantId, merchantId))
      await db.insert(themeVersions).values({
        merchantId,
        version: Number(peak?.peak ?? 0) + 1,
        config: {
          primaryColor: prev.primaryColor,
          secondaryColor: prev.secondaryColor,
          accentColor: prev.accentColor,
          logo: prev.logo ?? null,
          typography: prev.typography ?? {},
          header: prev.header ?? {},
          footer: prev.footer ?? {},
          config: prev.config ?? {}
        },
        note: typeof input.note === 'string' ? input.note.slice(0, 255) : null,
        createdBy: actorUserId ?? null
      })
    } catch (e) {
      log.error('theme version snapshot failed', { merchantId, error: e })
    }
    return this.get(db, merchantId)
  }

  /** Version history for the merchant theme (newest first). */
  static async listVersions(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(themeVersions)
      .where(eq(themeVersions.merchantId, merchantId))
      .orderBy(desc(themeVersions.version))
    return ok({ items: rows })
  }

  /**
   * Rollback: restore a historic version's full theme document as a NEW
   * update (which itself snapshots the pre-rollback state, so rollback is
   * undoable).
   */
  static async rollback(db: DB, merchantId: string, version: number, actorUserId?: string | null) {
    const rows = await db
      .select()
      .from(themeVersions)
      .where(eq(themeVersions.merchantId, merchantId))
    const found = rows.find((r) => r.version === version)
    if (!found) throw notFound('VERSION_NOT_FOUND', 'Theme version not found')
    const cfg = (found.config ?? {}) as Record<string, unknown>
    return this.update(
      db,
      merchantId,
      {
        primaryColor: typeof cfg.primaryColor === 'string' ? cfg.primaryColor : undefined,
        secondaryColor: typeof cfg.secondaryColor === 'string' ? cfg.secondaryColor : undefined,
        accentColor: typeof cfg.accentColor === 'string' ? cfg.accentColor : undefined,
        logo: (cfg.logo as string | null | undefined) ?? null,
        typography: (cfg.typography ?? {}) as Record<string, unknown>,
        header: (cfg.header ?? {}) as Record<string, unknown>,
        footer: (cfg.footer ?? {}) as Record<string, unknown>,
        config: (cfg.config ?? {}) as Record<string, unknown>,
        note: `rollback to v${version}`
      },
      actorUserId
    )
  }
}
