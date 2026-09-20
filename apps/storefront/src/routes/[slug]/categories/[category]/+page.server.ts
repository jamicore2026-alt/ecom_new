import { error } from '@sveltejs/kit'
import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	try {
		// Unknown slugs must 404 instead of rendering an empty listing.
		const tree = await storefrontApi.categories(fetch, params.slug)
		const known = tree.items.some((c) => c.slug === params.category)
		if (!known) error(404, 'Category not found')
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
