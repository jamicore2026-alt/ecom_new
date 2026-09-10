import { badRequest } from './errors'

const RESERVED_HOST_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT — routes to internal ranges
  /^localhost$/i,
  /^::1$/i,
  /^\[::1\]$/i,
  /^::$/i,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
  /^::ffff:/i
]

export const isReservedOrPrivateHost = (hostname: string): boolean => {
  const host = hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '')
  return RESERVED_HOST_PATTERNS.some((pattern) => pattern.test(host))
}

/**
 * Validate an outbound URL before it reaches fetch(): enforces an http(s)
 * scheme, blocks private/loopback/link-local targets (SSRF), and — when an
 * allowlist is supplied — restricts the host to the expected provider domains.
 * Returns a validated URL; throws a 400 badRequest otherwise.
 */
export const buildOutboundUrl = (
  value: string,
  opts: { allowHostnames?: string[]; allowHttp?: boolean } = {}
): URL => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw badRequest('INVALID_URL', 'Invalid outbound URL')
  }

  const isHttps = url.protocol === 'https:'
  const isHttp = url.protocol === 'http:'
  if (!isHttps && !(opts.allowHttp && isHttp)) {
    throw badRequest('INVALID_URL', 'Only https outbound URLs are allowed')
  }

  if (isReservedOrPrivateHost(url.hostname)) {
    throw badRequest('URL_HOST_FORBIDDEN', 'Outbound URL targets a private or reserved host — blocked')
  }

  const allowlist = opts.allowHostnames
  if (allowlist?.length) {
    const allowed = allowlist.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )
    if (!allowed) {
      throw badRequest('URL_NOT_ALLOWLISTED', `Outbound URL host "${url.hostname}" is not allowlisted`)
    }
  }

  return url
}