import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	const q = url.searchParams.get('q') ?? ''
	try {
		const products = await storefrontApi.search(fetch, params.slug, {
			search: q,
			page: url.searchParams.get('page') ?? '1',
			limit: 12
		})
		return { products, query: q }
	} catch (e) {
		loadError(e, 'Search failed')
	}
}
