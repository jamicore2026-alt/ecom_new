/**
 * Same-origin reverse proxy to the API service — single source of truth shared
 * by the web dashboard and the storefront.
 *
 * Production deployments give each frontend its own domain while the API runs
 * elsewhere; routing /api and /uploads through here keeps every browser
 * request first-party (no CORS, refresh cookies stay SameSite=Lax) without
 * touching any rendering code.
 */

const STRIP_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length'])
const STRIP_RESPONSE_HEADERS = new Set([
	'connection',
	'keep-alive',
	'transfer-encoding',
	'upgrade',
	'content-length',
	// fetch() transparently decompresses; forwarding these would corrupt the body
	'content-encoding'
])

// Private/loopback/link-local targets must never be the upstream — prevents a
// misconfigured API_ORIGIN from turning the proxy into an SSRF primitive.
const RESERVED_HOST_PATTERNS: RegExp[] = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^169\.254\./,
	/^0\./,
	/^localhost$/i,
	/^::1$/i,
	/^\[::1\]$/i,
	/^::$/i,
	/^fc00:/i,
	/^fd[0-9a-f]{2}:/i
]

const isReservedOrPrivateHost = (hostname: string): boolean => {
	const host = hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '')
	return RESERVED_HOST_PATTERNS.some((pattern) => pattern.test(host))
}

/**
 * Validate the configured upstream origin before proxying to it. Throws the
 * original URL back (the caller's catch renders an API_UNREACHABLE 502) when
 * the origin is not an http(s) URL or points at a private/reserved host.
 */
const assertProxyOrigin = (origin: string): string => {
	let url: URL
	try {
		url = new URL(origin)
	} catch {
		throw new Error(`Invalid API_ORIGIN "${origin}"`)
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`API_ORIGIN must use http:// or https:// (got "${url.protocol}")`)
	}
	if (isReservedOrPrivateHost(url.hostname)) {
		throw new Error(`API_ORIGIN points at a private/reserved host "${url.hostname}"`)
	}
	return origin
}

/**
 * SvelteKit URL-decodes `[...path]` params, so a `#` in an order number becomes
 * a raw `#` here. Re-encoding each segment keeps it `%23` in the upstream URL —
 * otherwise fetch truncates it as a fragment and the API 404s.
 */
const encodePath = (upstreamPath: string) =>
	upstreamPath
		.split('/')
		.map(encodeURIComponent)
		.join('/')
		.replace(/%2F/gi, '/')

export async function proxyToApi(
	request: Request,
	upstreamPath: string,
	search: string,
	apiOrigin: string
): Promise<Response> {
	const headers = new Headers()
	for (const [key, value] of request.headers) {
		if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value)
	}

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
	const body = hasBody ? await request.arrayBuffer() : undefined

	let upstream: Response
	try {
		upstream = await fetch(`${assertProxyOrigin(apiOrigin)}${encodePath(upstreamPath)}${search}`, {
			method: request.method,
			headers,
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(30_000)
		})
	} catch {
		return Response.json(
			{ success: false, error: { code: 'API_UNREACHABLE', message: 'API service is unavailable' } },
			{ status: 502 }
		)
	}

	const resHeaders = new Headers()
	for (const [key, value] of upstream.headers) {
		if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) resHeaders.set(key, value)
	}
	for (const cookie of upstream.headers.getSetCookie()) {
		resHeaders.append('set-cookie', cookie)
	}

	return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
}