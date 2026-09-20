import { browser } from '$app/environment'
import type { ApiErrorBody, AuthResponse, MeResponse } from './types'

// Cookie-based auth: the API sets httpOnly `md.access` (access JWT) and
// readable `md.csrf` (double-submit random hex) cookies on login/refresh.
// Same-origin relative /api fetches send cookies automatically, so we never
// store the access token in JS. The refresh CSRF token (`csrfToken` from the
// last login/refresh JSON body, a hash of the refresh jti) is kept in memory
// + localStorage under a distinct key and sent as X-CSRF-Token on refresh.
const OUTLET_KEY = 'md.outlet'
const REFRESH_CSRF_KEY = 'md.refresh-csrf'

let refreshCsrfMemory: string | null = null

export function getRefreshCsrf(): string | null {
	if (refreshCsrfMemory) return refreshCsrfMemory
	if (!browser) return null
	return localStorage.getItem(REFRESH_CSRF_KEY)
}

export function setRefreshCsrf(token: string | null) {
	refreshCsrfMemory = token
	if (!browser) return
	if (token) localStorage.setItem(REFRESH_CSRF_KEY, token)
	else localStorage.removeItem(REFRESH_CSRF_KEY)
}

/** Read the readable `md.csrf` double-submit cookie value. */
export function getCsrfCookie(): string | null {
	if (!browser) return null
	const parts = document.cookie.split(';')
	for (const part of parts) {
		const idx = part.indexOf('=')
		if (idx < 0) continue
		if (part.slice(0, idx).trim() === 'md.csrf') {
			return decodeURIComponent(part.slice(idx + 1).trim()) || null
		}
	}
	return null
}

export function getSelectedOutletId(): string | null {
	if (!browser) return null
	return localStorage.getItem(OUTLET_KEY)
}

export function setSelectedOutletId(outletId: string | null) {
	if (!browser) return
	if (outletId) localStorage.setItem(OUTLET_KEY, outletId)
	else localStorage.removeItem(OUTLET_KEY)
}

/** @deprecated Cookie auth no longer uses localStorage access tokens. Kept as no-op for compat. */
export function getAccessToken(): string | null {
	return null
}

/** @deprecated No-op — access token lives in the httpOnly `md.access` cookie. */
export function setAccessToken(_token: string | null) {
	// no-op
}

export function clearTokens() {
	setRefreshCsrf(null)
}

export class ApiError extends Error {
	status: number
	code: string
	fields?: Array<{ path: string; message: string }>

	constructor(body: ApiErrorBody['error'], status: number) {
		super(body?.message ?? 'Request failed')
		this.name = 'ApiError'
		this.code = body?.code ?? 'UNKNOWN'
		this.status = status
		this.fields = body?.fields
	}
}

let refreshPromise: Promise<void> | null = null

type AuthDataWithCsrf = AuthResponse['data'] & { csrfToken?: string }

async function performRefresh(): Promise<void> {
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	const refreshCsrf = getRefreshCsrf()
	// Cookie-refresh callers MUST send the csrfToken from the last
	// login/refresh JSON body as X-CSRF-Token.
	if (refreshCsrf) headers['x-csrf-token'] = refreshCsrf
	const res = await fetch('/api/auth/refresh', {
		method: 'POST',
		headers,
		body: JSON.stringify({})
	})
	const body = (await res.json().catch(() => null)) as AuthResponse | ApiErrorBody | null
	if (!res.ok || !body || !('data' in body)) {
		throw new ApiError(
			body && 'error' in body ? (body as ApiErrorBody).error : { code: 'SESSION_EXPIRED', message: 'Session expired' },
			res.status
		)
	}
	const data = (body as AuthResponse).data as AuthDataWithCsrf
	if (data.csrfToken) setRefreshCsrf(data.csrfToken)
}

function refreshTokens(): Promise<void> {
	refreshPromise ??= performRefresh().finally(() => {
		refreshPromise = null
	})
	return refreshPromise
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
	const headers = new Headers(options.headers)
	const method = (options.method ?? 'GET').toUpperCase()
	if (MUTATING.has(method)) {
		const csrf = getCsrfCookie()
		if (csrf) headers.set('x-csrf-token', csrf)
	}
	const outletId = getSelectedOutletId()
	if (outletId) headers.set('x-outlet-id', outletId)
	if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) {
		headers.set('content-type', 'application/json')
	}

	const res = await fetch(path, { ...options, headers })

	if (res.status === 401 && retry) {
		try {
			await refreshTokens()
		} catch {
			clearTokens()
			throw new ApiError({ code: 'SESSION_EXPIRED', message: 'Session expired' }, 401)
		}
		return request<T>(path, options, false)
	}

	const text = await res.text()
	let body: unknown = null
	if (text) {
		try {
			body = JSON.parse(text)
		} catch {
			body = text
		}
	}

	if (!res.ok) {
		if (body && typeof body === 'object' && 'error' in (body as object)) {
			throw new ApiError((body as ApiErrorBody).error, res.status)
		}
		throw new ApiError({ code: 'HTTP_ERROR', message: text || `Request failed (${res.status})` }, res.status)
	}

	return body as T
}

export const api = {
	get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) => {
		const qs = new URLSearchParams()
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
			}
		}
		const suffix = qs.toString() ? `?${qs.toString()}` : ''
		return request<T>(`${path}${suffix}`)
	},
	post: <T>(path: string, body?: unknown) =>
		request<T>(path, {
			method: 'POST',
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
	put: <T>(path: string, body?: unknown) =>
		request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
	patch: <T>(path: string, body?: unknown) =>
		request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
	delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
	upload: <T>(path: string, form: FormData) => {
		const headers = new Headers()
		const csrf = getCsrfCookie()
		if (csrf) headers.set('x-csrf-token', csrf)
		return request<T>(path, { method: 'POST', body: form, headers })
	},
	download: async (path: string, filename: string): Promise<void> => {
		const res = await fetch(path)
		if (!res.ok) {
			throw new ApiError({ code: 'HTTP_ERROR', message: `Download failed (${res.status})` }, res.status)
		}
		const blob = await res.blob()
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = filename
		a.click()
		URL.revokeObjectURL(url)
	}
}

export async function login(input: { email: string; password: string; merchantSlug?: string }): Promise<AuthResponse> {
	const res = await fetch('/api/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	})
	const body = (await res.json().catch(() => null)) as AuthResponse | ApiErrorBody | null
	if (!res.ok || !body || !('data' in body)) {
		throw new ApiError(
			body && 'error' in body ? body.error : { code: 'REQUEST_FAILED', message: 'Login failed' },
			res.status
		)
	}
	// Access token lives in the httpOnly cookie — never store it in JS.
	// Persist only the refresh csrfToken for cookie-based refresh calls.
	const data = body.data as AuthDataWithCsrf
	if (data.csrfToken) setRefreshCsrf(data.csrfToken)
	return body
}

export async function fetchMe(): Promise<MeResponse> {
	return request<MeResponse>('/api/auth/me')
}

export async function logout() {
	try {
		const headers: Record<string, string> = { 'content-type': 'application/json' }
		const csrf = getCsrfCookie()
		if (csrf) headers['x-csrf-token'] = csrf
		await fetch('/api/auth/logout', {
			method: 'POST',
			headers,
			body: '{}'
		})
	} catch {
		// ignore network failures on sign-out
	}
	clearTokens()
}
