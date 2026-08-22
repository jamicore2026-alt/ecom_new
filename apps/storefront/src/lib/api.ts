import { error } from '@sveltejs/kit'
import type {
	CategoryTree,
	CheckoutInput,
	CheckoutOrder,
	CheckoutPreviewInput,
	CheckoutSummary,
	OrderDetail,
	Page,
	ProductDetail,
	ProductSummary,
	StoreInfo
} from './types'

const base = '/api/store'

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message)
		this.name = 'ApiError'
	}
}

export const qs = (params: Record<string, unknown>) => {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== '') {
			search.set(key, String(value))
		}
	}
	const s = search.toString()
	return s ? `?${s}` : ''
}

const request = async <T>(
	fetchFn: typeof fetch,
	path: string,
	init?: RequestInit
): Promise<T> => {
	const res = await fetchFn(`${base}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
	})
	const body = await res.json().catch(() => null)
	if (!res.ok || !body?.success) {
		const error = body?.error
		throw new ApiError(res.status, error?.code ?? 'REQUEST_FAILED', error?.message ?? 'Request failed')
	}
	return body.data as T
}

export type ProductListParams = {
	page?: number | string
	limit?: number | string
	search?: string
	category?: string
	minPrice?: string | number
	maxPrice?: string | number
	sort?: 'price_asc' | 'price_desc' | 'newest'
}

export const storefrontApi = {
	info: (fetchFn: typeof fetch, slug: string) =>
		request<StoreInfo>(fetchFn, `/${slug}/store`),

	categories: (fetchFn: typeof fetch, slug: string) =>
		request<CategoryTree>(fetchFn, `/${slug}/categories`),

	products: (fetchFn: typeof fetch, slug: string, params: ProductListParams = {}) =>
		request<Page<ProductSummary>>(fetchFn, `/${slug}/products${qs(params)}`),

	product: (fetchFn: typeof fetch, slug: string, productSlug: string) =>
		request<ProductDetail>(fetchFn, `/${slug}/products/${productSlug}`),

	search: (fetchFn: typeof fetch, slug: string, params: ProductListParams = {}) =>
		request<Page<ProductSummary>>(fetchFn, `/${slug}/search${qs(params)}`),

	checkoutPreview: (fetchFn: typeof fetch, slug: string, body: CheckoutPreviewInput) =>
		request<CheckoutSummary>(fetchFn, `/${slug}/checkout/preview`, {
			method: 'POST',
			body: JSON.stringify(body)
		}),

	checkout: (fetchFn: typeof fetch, slug: string, body: CheckoutInput) =>
		request<CheckoutOrder>(fetchFn, `/${slug}/checkout`, {
			method: 'POST',
			body: JSON.stringify(body)
		}),

	order: (fetchFn: typeof fetch, slug: string, orderNumber: string) =>
		request<OrderDetail>(fetchFn, `/${slug}/orders/${orderNumber}`)
}

export function loadError(err: unknown, notFoundMessage: string): never {
	if (err instanceof ApiError) {
		if (err.status === 404) error(404, notFoundMessage)
		error(err.status >= 500 ? 500 : err.status, err.message || 'Request failed')
	}
	throw err
}
