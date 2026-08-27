import { eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { themeConfigs } from '../../database/schema'
import { ok } from '../../shared/response'

export class ThemeService {
  static async get(merchantId: string) {
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
    }
  ) {
    const current = await this.get(merchantId)
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
    return this.get(merchantId)
  }
}
