import { getRateLimitStore } from '../../shared/rate-limit'

export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60_000
export const LOGIN_ATTEMPT_MAX = 5
export const LOGIN_LOCKOUT_MS = 15 * 60_000

const failuresKey = (email: string) => `login-failures:${email}`
const lockKey = (email: string) => `login-lock:${email}`

export const loginAttempts = {
  async get(email: string) {
    return (await getRateLimitStore().get(lockKey(email))) > 0
  },

  async increment(email: string) {
    const result = await getRateLimitStore().incrementAndCheck(
      failuresKey(email),
      LOGIN_ATTEMPT_WINDOW_MS,
      LOGIN_ATTEMPT_MAX
    )

    if (result.count >= LOGIN_ATTEMPT_MAX) {
      // A separate key gives the lockout its own 15-minute lifetime starting
      // at the fifth failure, rather than inheriting the failure-window TTL.
      await getRateLimitStore().incrementAndCheck(lockKey(email), LOGIN_LOCKOUT_MS, 1)
    }

    return result
  },

  async reset(email: string) {
    const store = getRateLimitStore()
    await Promise.all([store.reset(failuresKey(email)), store.reset(lockKey(email))])
  }
}
