import { env } from '$env/dynamic/private'

const API_ORIGIN = (env.API_ORIGIN ?? 'http://localhost:3005').replace(/\/+$/, '')

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

/**
 * Same-origin reverse proxy to the API service.
 *
 * Production deployments give each frontend its own domain while the API runs
 * elsewhere; routing /api and /uploads through here keeps every browser
 * request first-party (no CORS, refresh cookies stay SameSite=Lax) without
 * touching any rendering code.
 */
export async function proxyToApi(request: Request, upstreamPath: string, search: string): Promise<Response> {
	const headers = new Headers()
	for (const [key, value] of request.headers) {
		if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value)
	}

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
	const body = hasBody ? await request.arrayBuffer() : undefined

	let upstream: Response
	try {
		upstream = await fetch(`${API_ORIGIN}${upstreamPath}${search}`, {
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
