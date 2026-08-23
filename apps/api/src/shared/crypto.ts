import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

const getKey = () => {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set — payment credentials cannot be stored securely')
  }
  return createHash('sha256').update(secret).digest()
}

export const encryptJson = (value: object): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
}

export const decryptJson = <T = Record<string, string>>(payload: string): T => {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid ciphertext payload')
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ])
  return JSON.parse(decrypted.toString('utf8')) as T
}

/** Masks a secret for API responses — keeps only the last 4 chars. */
export const maskSecret = (value?: string | null) =>
  value ? `••••${value.slice(-4)}` : ''

export const MASK_PREFIX = '••••'

export const isMaskedValue = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(MASK_PREFIX)
