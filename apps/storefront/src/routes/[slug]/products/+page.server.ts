import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	const query: Record<string, string> = {}
	const sort = url.searchParams.get('sort')
	const minPrice = url.searchParams.get('minPrice')
	const maxPrice = url.searchParams.get('maxPrice')
	if (sort) query.sort = sort
	if (minPrice) query.minPrice = minPrice
	if (maxPrice) query.maxPrice = maxPrice

	try {
		const products = await storefrontApi.products(fetch, params.slug, {
			page: url.searchParams.get('page') ?? '1',
			limit: 12,
			sort: (sort ?? undefined) as 'price_asc' | 'price_desc' | 'newest' | undefined,
			minPrice: minPrice ?? undefined,
			maxPrice: maxPrice ?? undefined
		})
		return { products, query }
	} catch (e) {
		loadError(e, 'Products are unavailable right now')
	}
}
