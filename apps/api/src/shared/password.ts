import { badRequest } from './errors'

/**
 * Platform password policy: min 12 chars with upper + lower + digit.
 * Enforced in staff auth, shopper auth, staff create/invite-accept.
 * Error code is always WEAK_PASSWORD so clients can map it clearly.
 */
export const PASSWORD_MIN_LENGTH = 12

export function validatePassword(password: string): void {
  const fails =
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  if (fails) {
    throw badRequest(
      'WEAK_PASSWORD',
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include upper-case, lower-case and a digit`
    )
  }
}
