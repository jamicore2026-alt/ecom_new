import { describe, expect, test } from 'bun:test'

process.env.NODE_ENV = 'test'
const { validatePassword, PASSWORD_MIN_LENGTH } = await import('../src/shared/password')
const { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } = await import('../src/modules/mfa/service')

describe('password policy (min 12 + upper/lower/digit, WEAK_PASSWORD)', () => {
  test('accepts a strong password', () => {
    expect(() => validatePassword('StrongPass123')).not.toThrow()
  })

  test('rejects short passwords', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    try {
      validatePassword('Short1Aa')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { code?: string }).code ?? String(e)).toMatch(/WEAK_PASSWORD/)
    }
  })

  test('rejects passwords missing a character class', () => {
    for (const pw of ['alllowercase12', 'ALLUPPERCASE12', 'NoDigitsHereAA']) {
      try {
        validatePassword(pw)
        throw new Error(`should have thrown for ${pw}`)
      } catch (e) {
        expect((e as { code?: string }).code ?? (e as Error).message).toMatch(/WEAK_PASSWORD/)
      }
    }
  })
})

describe('session lifetime caps', () => {
  test('absolute cap is 30 days', () => {
    expect(SESSION_ABSOLUTE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  test('idle timeout is 7 days', () => {
    expect(SESSION_IDLE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
