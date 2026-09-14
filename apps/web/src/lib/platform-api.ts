// Platform (super admin) API client — deliberately minimal and cookie-only.
// Unlike $lib/api.ts it never touches the merchant access token (md.access) or
// the merchant refresh flow. Sessions ride the httpOnly pd.session cookie the
// API sets; the client just forwards it and lets the /api/* proxy pass it on.
import { ApiError } from './api'
import type { ApiErrorBody } from './types'

async function raw(url: string, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers)
	if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
		headers.set('content-type', 'application/json')
	}
	return fetch(url, { ...init, headers, credentials: 'same-origin' })
}

async function envelope<T>(url: string, init: RequestInit = {}): Promise<T> {
	const res = await raw(url, init)
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
	return (body as { data: T }).data
}

export const platformApi = {
	login: (email: string, password: string) =>
		envelope<{ email: string }>('/api/platform/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email, password })
		}),
	logout: async () => {
		try {
			await raw('/api/platform/auth/logout', { method: 'POST', body: '{}' })
		} catch {
			// ignore network failures on sign-out
		}
	},
	listMerchants: (params: { page?: number; limit?: number; status?: string; search?: string }) => {
		const qs = new URLSearchParams()
		if (params.page) qs.set('page', String(params.page))
		if (params.limit) qs.set('limit', String(params.limit))
		if (params.status) qs.set('status', params.status)
		if (params.search) qs.set('search', params.search)
		return envelope<{ items: import('./types').PlatformMerchantSummary[]; meta: import('./types').PaginationMeta }>(
			`/api/platform/merchants?${qs.toString()}`
		)
	},
	getMerchant: (id: string) =>
		envelope<import('./types').PlatformMerchantDetailResponse>(`/api/platform/merchants/${id}`),
	changeStatus: (id: string, to: string, reason: string) =>
		envelope<{ merchant: { id: string; name: string; slug: string; status: string; from: string } }>(
			`/api/platform/merchants/${id}/status`,
			{ method: 'POST', body: JSON.stringify({ to, reason }) }
		)
}