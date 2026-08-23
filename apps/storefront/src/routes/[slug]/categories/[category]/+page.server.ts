import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	try {
		const products = await storefrontApi.products(fetch, params.slug, {
			category: params.category,
			page: url.searchParams.get('page') ?? '1',
			limit: 12
		})
		return { products, category: params.category }
	} catch (e) {
		loadError(e, 'Category not found')
	}
}
