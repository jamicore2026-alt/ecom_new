import { error } from '@sveltejs/kit'
import type {
	CategoryTree,
	CheckoutInput,
	CheckoutOrder,
	CheckoutPreviewInput,
	CheckoutSummary,
	OrderDetail,
	Page,
	PaymentSyncResult,
	ProductDetail,
	ProductReview,
	ProductSummary,
	ProviderCheckoutSession,
	ShopperCustomer,
	ShopperOrderSummary,
	ShopperSessionData,
	StoreInfo,
	SubmittedReview,
	WishListItem
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
	stores: (fetchFn: typeof fetch) =>
		request<Array<{ slug: string; name: string }>>(fetchFn, ``),

	info: (fetchFn: typeof fetch, slug: string) =>
		request<StoreInfo>(fetchFn, `/${slug}/store`),

	categories: (fetchFn: typeof fetch, slug: string) =>
		request<CategoryTree>(fetchFn, `/${slug}/categories`),

	sitemap: (fetchFn: typeof fetch, slug: string) =>
		request<{ categories: Array<{ slug: string }>; products: Array<{ slug: string }> }>(
			fetchFn,
			`/${slug}/sitemap`
		),

	products: (fetchFn: typeof fetch, slug: string, params: ProductListParams = {}) =>
		request<Page<ProductSummary>>(fetchFn, `/${slug}/products${qs(params)}`),

	product: (fetchFn: typeof fetch, slug: string, productSlug: string) =>
		request<ProductDetail>(fetchFn, `/${slug}/products/${productSlug}`),

	productReviews: (
		fetchFn: typeof fetch,
		slug: string,
		productSlug: string,
		params: { page?: number | string; limit?: number | string } = {}
	) => request<Page<ProductReview>>(fetchFn, `/${slug}/products/${productSlug}/reviews${qs(params)}`),

	submitReview: (
		fetchFn: typeof fetch,
		slug: string,
		token: string,
		body: { productId: string; rating: number; title?: string; body?: string }
	) =>
		request<SubmittedReview>(fetchFn, `/${slug}/auth/reviews`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
			body: JSON.stringify(body)
		}),

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

	checkoutPay: (fetchFn: typeof fetch, slug: string, body: CheckoutInput) =>
		request<ProviderCheckoutSession>(fetchFn, `/${slug}/checkout/pay`, {
			method: 'POST',
			body: JSON.stringify(body)
		}),

	syncOrder: (
		fetchFn: typeof fetch,
		slug: string,
		orderNumber: string,
		body: { paymentId?: string } = {}
	) =>
		request<PaymentSyncResult>(fetchFn, `/${slug}/orders/${encodeURIComponent(orderNumber)}/sync`, {
			method: 'POST',
			body: JSON.stringify(body)
		}),

	order: (fetchFn: typeof fetch, slug: string, orderNumber: string) =>
		request<OrderDetail>(fetchFn, `/${slug}/orders/${orderNumber}`),

	registerAccount: (fetchFn: typeof fetch, slug: string, body: { email: string; password: string; firstName?: string; lastName?: string }) =>
		request<ShopperSessionData>(fetchFn, `/${slug}/auth/register`, {
			method: 'POST',
			body: JSON.stringify(body)
		}),

	loginAccount: (fetchFn: typeof fetch, slug: string, body: { email: string; password: string }) =>
		request<ShopperSessionData>(fetchFn, `/${slug}/auth/login`, {
			method: 'POST',
			body: JSON.stringify(body)
		}),

	me: (fetchFn: typeof fetch, slug: string, token: string) =>
		request<ShopperCustomer>(fetchFn, `/${slug}/auth/me`, {
			headers: { authorization: `Bearer ${token}` }
		}),

	myOrders: (
		fetchFn: typeof fetch,
		slug: string,
		token: string,
		params: { page?: number | string; limit?: number | string } = {}
	) =>
		request<Page<ShopperOrderSummary>>(fetchFn, `/${slug}/auth/orders${qs(params)}`, {
			headers: { authorization: `Bearer ${token}` }
		}),

	wishlist: (fetchFn: typeof fetch, slug: string, token: string) =>
		request<{ items: WishListItem[] }>(fetchFn, `/${slug}/auth/wishlist`, {
			headers: { authorization: `Bearer ${token}` }
		}),

	wishlistAdd: (fetchFn: typeof fetch, slug: string, token: string, productId: string) =>
		request<{ saved: boolean }>(fetchFn, `/${slug}/auth/wishlist`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
			body: JSON.stringify({ productId })
		}),

	wishlistRemove: (fetchFn: typeof fetch, slug: string, token: string, productId: string) =>
		request<{ removed: boolean }>(
			fetchFn,
			`/${slug}/auth/wishlist/${encodeURIComponent(productId)}`,
			{ method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
		)
}

export function loadError(err: unknown, notFoundMessage: string): never {
	if (err instanceof ApiError) {
		if (err.status === 404) error(404, notFoundMessage)
		error(err.status >= 500 ? 500 : err.status, err.message || 'Request failed')
	}
	throw err
}
