import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { notFound } from '../../shared/errors'
import { storage, UPLOAD_URL_PREFIX } from '../../shared/storage'
import { UploadsService } from './service'
import { uploadBody } from './model'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
}

// NOTE: the public file-serving route is registered BEFORE the auth-guarded
// upload route — Elysia's scoped derives only apply to later registrations.
export const uploadsModule = new Elysia({ name: 'uploads' })
  .get(`${UPLOAD_URL_PREFIX}/*`, async ({ params, set }) => {
    const key = params['*']
    const ext = key.split('.').pop()?.toLowerCase() ?? ''
    const contentType = CONTENT_TYPES[ext]
    if (!contentType) throw notFound('NOT_FOUND', 'File not found')
    const file = await storage.read(key)
    if (!file) throw notFound('NOT_FOUND', 'File not found')
    set.headers['content-type'] = contentType
    set.headers['cache-control'] = 'public, max-age=31536000, immutable'
    return new Response(file.stream())
  })
  .use(authPlugin)
  .use(requirePermission('products:write'))
  .post(
    '/api/uploads',
    async ({ body, auth }) => {
      const stored = await UploadsService.saveImages(auth.merchant.id, body.files)
      return { success: true as const, data: stored }
    },
    { body: uploadBody, detail: { summary: 'Upload product images (multipart)' } }
  )
