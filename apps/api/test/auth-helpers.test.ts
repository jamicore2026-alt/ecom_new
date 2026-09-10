import { afterEach, describe, expect, test } from 'bun:test'
import type { AuthContext } from '../src/plugins/auth'
import type { Role, User } from '../src/database/schema'

// Load the module AFTER pinning NODE_ENV so its top-level JWT secret resolution
// (resolveSecret) cannot throw when the production check is active.
process.env.NODE_ENV = 'test'
const { resolveSecret, hashToken, isAdmin, hasPermission } = await import('../src/plugins/auth')

const makeAuth = (
  over: { user?: Partial<User>; role?: Partial<Role> | null } = {}
): AuthContext =>
  ({
    user: {
      id: 'u1',
      role: 'staff',
      merchantId: 'm1',
      status: 'active',
      permissions: [],
      ...(over.user ?? {})
    },
    merchant: { id: 'm1', slug: 'store', status: 'active' },
    role: over.role ?? null
  }) as AuthContext

afterEach(() => {
  process.env.NODE_ENV = 'test'
  delete process.env.JWT_TEST_SECRET
  delete process.env.JWT_ACCESS_SECRET
  delete process.env.JWT_REFRESH_SECRET
})

describe('resolveSecret', () => {
  test('throws in production when the secret is missing', () => {
    process.env.NODE_ENV = 'production'
    expect(() => resolveSecret('JWT_TEST_SECRET', 'fallback')).toThrow(/must be set/)
  })

  test('throws in production when the secret is still the fallback', () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_TEST_SECRET = 'fallback'
    expect(() => resolveSecret('JWT_TEST_SECRET', 'fallback')).toThrow(/must be set/)
  })

  test('returns the configured secret in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_TEST_SECRET = 'not-the-fallback'
    expect(resolveSecret('JWT_TEST_SECRET', 'fallback')).toBe('not-the-fallback')
  })

  test('returns the fallback outside production', () => {
    process.env.NODE_ENV = 'test'
    expect(resolveSecret('JWT_TEST_SECRET', 'fallback')).toBe('fallback')
  })
})

describe('hashToken', () => {
  test('produces a fixed-length deterministic hex digest', () => {
    const first = hashToken('abc')
    expect(first).toBe(hashToken('abc'))
    expect(first).toHaveLength(64)
    expect(first).toMatch(/^[0-9a-f]+$/)
  })

  test('differs for distinct tokens', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})

describe('isAdmin', () => {
  test('owner and admin are admins', () => {
    expect(isAdmin(makeAuth({ user: { role: 'owner' } }))).toBe(true)
    expect(isAdmin(makeAuth({ user: { role: 'admin' } }))).toBe(true)
  })

  test('staff are not admins', () => {
    expect(isAdmin(makeAuth())).toBe(false)
  })
})

describe('hasPermission', () => {
  test('admins bypass permission checks', () => {
    const auth = makeAuth({ user: { role: 'owner', permissions: [] } })
    expect(hasPermission(auth, 'reports.read')).toBe(true)
  })

  test('grants permissions granted directly on the user row', () => {
    const auth = makeAuth({ user: { role: 'staff', permissions: ['orders.read'] } })
    expect(hasPermission(auth, 'orders.read')).toBe(true)
    expect(hasPermission(auth, 'reports.read')).toBe(false)
  })

  test('grants permissions inherited from the role row', () => {
    const auth = makeAuth({
      user: { role: 'staff', permissions: [] },
      role: { permissions: ['inventory.manage'] } as never
    })
    expect(hasPermission(auth, 'inventory.manage')).toBe(true)
  })
})