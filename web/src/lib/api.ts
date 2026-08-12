import { browser } from '$app/environment'
import type { ApiErrorBody, AuthResponse, MeResponse } from './types'

const ACCESS_KEY = 'md.access'
const REFRESH_KEY = 'md.refresh'

export function getAccessToken(): string | null {
	if (!browser) return null
	return localStorage.getItem(ACCESS_KEY)
}

export function getRefreshToken(): string | null {
	if (!browser) return null
	return localStorage.getItem(REFRESH_KEY)
}

export function setTokens(access: string, refresh: string) {
	if (!browser) return
	localStorage.setItem(ACCESS_KEY, access)
	localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens() {
	if (!browser) return
	localStorage.removeItem(ACCESS_KEY)
	localStorage.removeItem(REFRESH_KEY)
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

let refreshPromise: Promise<AuthResponse> | null = null

async function refreshTokens(): Promise<AuthResponse> {
	const refreshToken = getRefreshToken()
	if (!refreshToken) throw new ApiError({ code: 'NO_REFRESH', message: 'No refresh token' }, 401)

	const res = await fetch('/api/auth/refresh', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ refreshToken })
	})
	const body = (await res.json()) as AuthResponse | ApiErrorBody
	if (!res.ok || !('data' in body)) {
		clearTokens()
		throw new ApiError('data' in body ? (body as never) : (body as ApiErrorBody).error, res.status)
	}
	setTokens(body.data.accessToken, body.data.refreshToken)
	return body
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
	const access = getAccessToken()
	const headers = new Headers(options.headers)
	if (access) headers.set('authorization', `Bearer ${access}`)
	if (options.body && !headers.has('content-type')) {
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
	delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
}

export async function login(input: { email: string; password: string; merchantSlug?: string }): Promise<AuthResponse> {
	const res = await fetch('/api/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	})
	const body = (await res.json()) as AuthResponse | ApiErrorBody
	if (!res.ok || !('data' in body)) {
		throw new ApiError('data' in body ? (body as never) : (body as ApiErrorBody).error, res.status)
	}
	setTokens(body.data.accessToken, body.data.refreshToken)
	return body
}

export async function fetchMe(): Promise<MeResponse> {
	return request<MeResponse>('/api/auth/me')
}

export async function logout() {
	try {
		await request('/api/auth/logout', {
			method: 'POST',
			body: JSON.stringify({ refreshToken: getRefreshToken() })
		})
	} catch {
		// ignore
	}
	clearTokens()
}
