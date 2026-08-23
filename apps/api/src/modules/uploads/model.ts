import { t } from 'elysia'

export const uploadBody = t.Object({
  files: t.Files({
    type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxSize: 5 * 1024 * 1024
  })
})
