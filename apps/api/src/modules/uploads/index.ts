import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { badRequest, notFound } from '../../shared/errors'
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

/**
 * Magic-byte sniffing — the declared filename extension is never trusted.
 * Prevents serving HTML/JS payloads under an image content type (stored XSS).
 */
const detectImageKind = async (file: File): Promise<keyof typeof CONTENT_TYPES | null> => {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const hex = Array.from(head.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (hex.startsWith('ffd8ff')) return 'jpg'
  if (hex === '89504e47') return 'png'
  if (hex.startsWith('47494638')) return 'gif'
  // RIFF....WEBP
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return 'webp'
  }
  return null
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
    set.headers['x-content-type-options'] = 'nosniff'
    set.headers['content-disposition'] = `inline; filename="${key.split('/').pop()?.replace(/[^\w.-]/g, '_') ?? 'file'}"`
    return new Response(file.stream())
  })
  .use(authPlugin)
  .use(requirePermission('products:write'))
  .post(
    '/api/uploads',
    async ({ body, auth }) => {
      for (const f of body.files) {
        const kind = await detectImageKind(f)
        if (!kind) throw badRequest('BAD_REQUEST', `Unsupported or corrupt image: ${f.name}`)
      }
      const stored = await UploadsService.saveImages(auth.merchant.id, body.files)
      return { success: true as const, data: stored }
    },
    { body: uploadBody, detail: { summary: 'Upload product images (multipart)' } }
  )
