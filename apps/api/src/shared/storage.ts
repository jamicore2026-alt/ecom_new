import { mkdir } from 'node:fs/promises'
import { createId } from '@paralleldrive/cuid2'

export const UPLOAD_URL_PREFIX = '/uploads'
const MAX_FILE_BYTES = 5 * 1024 * 1024

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

export interface StoredFile {
  /** Relative public URL, e.g. `/uploads/{merchantId}/{id}.webp` */
  url: string
  /** Storage key, e.g. `{merchantId}/{id}.webp` */
  key: string
  contentType: string
  size: number
}

/**
 * Pluggable file storage. Local disk first; S3/R2 adapters can implement
 * the same surface later without touching callers.
 */
export interface StorageAdapter {
  save(merchantId: string, file: File): Promise<StoredFile>
  read(key: string): Promise<File | null>
  remove(key: string): Promise<void>
}

const extFromType = (type: string) => ALLOWED_IMAGE_TYPES[type]

/** Local-disk storage rooted at UPLOAD_DIR (default: <api>/uploads). */
class LocalDiskStorage implements StorageAdapter {
  private root =
    process.env.UPLOAD_DIR ?? `${import.meta.dir}/../../uploads`

  private resolve(key: string) {
    const safe = key.replaceAll('..', '').replace(/^\/+/, '')
    return `${this.root}/${safe}`
  }

  async save(merchantId: string, file: File): Promise<StoredFile> {
    const type = file.type || 'application/octet-stream'
    const ext = extFromType(type)
    if (!ext) throw new Error(`Unsupported image type: ${type}`)
    if (file.size > MAX_FILE_BYTES) throw new Error('Image exceeds the 5MB limit')
    if (file.size === 0) throw new Error('Image is empty')

    const name = `${createId()}.${ext}`
    const key = `${merchantId}/${name}`
    await mkdir(`${this.root}/${merchantId}`, { recursive: true })
    await Bun.write(this.resolve(key), file)
    return {
      url: `${UPLOAD_URL_PREFIX}/${key}`,
      key,
      contentType: type,
      size: file.size
    }
  }

  async read(key: string): Promise<File | null> {
    const path = this.resolve(key)
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return file as unknown as File
  }

  async remove(key: string): Promise<void> {
    await Bun.$`rm -f ${this.resolve(key)}`.quiet()
  }
}

export const storage: StorageAdapter = new LocalDiskStorage()
