// Platform (super admin) API client — deliberately minimal and cookie-only.
// Unlike $lib/api.ts it never touches the merchant access token (md.access) or
// the merchant refresh flow. Sessions ride the httpOnly pd.session cookie the
// API sets; the client just forwards it and lets the /api/* proxy pass it on.
import { goto } from '$app/navigation'
import { ApiError } from './api'
import type { ApiErrorBody } from './types'

function csrfToken(): string | null {
	if (typeof document === 'undefined') return null
	const match = document.cookie
		.split(';')
		.map((s) => s.trim())
		.find((s) => s.startsWith('pd.csrf='))
	return match ? decodeURIComponent(match.slice('pd.csrf='.length)) : null
}

async function raw(url: string, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers)
	if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
		headers.set('content-type', 'application/json')
	}
	const method = (init.method ?? 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
		const token = csrfToken()
		if (token) headers.set('x-csrf-token', token)
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
		if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/auth/login')) {
			window.location.href = '/platform/login'
		}
		if (body && typeof body === 'object' && 'error' in (body as object)) {
			throw new ApiError((body as ApiErrorBody).error, res.status)
		}
		throw new ApiError({ code: 'HTTP_ERROR', message: text || `Request failed (${res.status})` }, res.status)
	}
	return (body as { data: T }).data
}

export const platformApi = {
	login: (email: string, password: string) =>
		envelope<{ email: string } | { mfaRequired: true; mfaToken: string }>('/api/platform/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email, password })
		}),
	verifyMfa: (mfaToken: string, code?: string, backupCode?: string) =>
		envelope<{ email: string }>('/api/platform/auth/mfa/verify', {
			method: 'POST',
			body: JSON.stringify({ mfaToken, code, backupCode })
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
		),
	createMerchant: (input: {
		name: string
		slug: string
		email: string
		phone?: string
		currency?: string
		owner: { name: string; email: string; password: string }
	}) =>
		envelope<{
			merchant: { id: string; name: string; slug: string; email: string; status: string }
			owner: { id: string; email: string }
		}>(`/api/platform/merchants`, { method: 'POST', body: JSON.stringify(input) }),
	listModules: (id: string) =>
		envelope<Array<{ module: string; enabled: boolean }>>(`/api/platform/merchants/${id}/modules`),
	setModule: (id: string, module: string, enabled: boolean) =>
		envelope<{ module: string; enabled: boolean }>(`/api/platform/merchants/${id}/modules`, {
			method: 'PUT',
			body: JSON.stringify({ module, enabled })
		}),
	listAdmins: () =>
		envelope<Array<{ id: string; email: string; status: string; lastLoginAt: string | null; mfaEnabled: boolean; createdAt: string }>>(
			`/api/platform/admins`
		),
	createAdmin: (email: string, password: string) =>
		envelope<{ id: string; email: string }>(`/api/platform/admins`, {
			method: 'POST',
			body: JSON.stringify({ email, password })
		}),
	setAdminStatus: (id: string, status: 'active' | 'disabled') =>
		envelope<{ id: string; email: string; status: string }>(`/api/platform/admins/${id}/status`, {
			method: 'POST',
			body: JSON.stringify({ status })
		}),
	revokeAdminSessions: (id: string) =>
		envelope<{ revoked: boolean }>(`/api/platform/admins/${id}/revoke`, { method: 'POST', body: '{}' }),
	changeOwnPassword: (oldPassword: string, newPassword: string) =>
		envelope<{ changed: boolean }>(`/api/platform/auth/password`, {
			method: 'POST',
			body: JSON.stringify({ oldPassword, newPassword })
		}),
	mfaStatus: () => envelope<{ mfaEnabled: boolean; backupCodesRemaining: number }>(`/api/platform/mfa/status`),
	mfaSetup: () => envelope<{ otpauthUrl: string; secret: string }>(`/api/platform/mfa/setup`, { method: 'POST', body: '{}' }),
	mfaEnable: (code: string) => envelope<{ enabled: boolean; backupCodes: string[] }>(`/api/platform/mfa/enable`, {
			method: 'POST',
			body: JSON.stringify({ code })
		}),
	mfaDisable: (password: string) => envelope<{ disabled: boolean }>(`/api/platform/mfa/disable`, {
			method: 'POST',
			body: JSON.stringify({ password })
		}),
	me: () => envelope<{ id: string; email: string; mfaEnabled: boolean }>(`/api/platform/auth/me`)
}