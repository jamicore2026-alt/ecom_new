import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const [product, reviews] = await Promise.all([
			storefrontApi.product(fetch, params.slug, params.product),
			storefrontApi
				.productReviews(fetch, params.slug, params.product, { limit: 10 })
				.catch(() => ({ items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } }))
		])
		return { product, reviews }
	} catch (e) {
		loadError(e, 'Product not found')
	}
}
