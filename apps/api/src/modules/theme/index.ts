import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ThemeService } from './service'

const themeBody = t.Object({
  primaryColor: t.Optional(t.String({ maxLength: 20 })),
  secondaryColor: t.Optional(t.String({ maxLength: 20 })),
  accentColor: t.Optional(t.String({ maxLength: 20 })),
  logo: t.Optional(t.Nullable(t.String({ maxLength: 1024 }))),
  typography: t.Optional(t.Record(t.String(), t.Any())),
  header: t.Optional(t.Record(t.String(), t.Any())),
  footer: t.Optional(t.Record(t.String(), t.Any())),
  config: t.Optional(t.Record(t.String(), t.Any()))
})

export const themeModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/theme', async ({ auth }) => ThemeService.get(auth.merchant.id))
  .use(requirePermission('settings:write'))
  .put('/theme', async ({ auth, body }) => ThemeService.update(auth.merchant.id, body), { body: themeBody })
