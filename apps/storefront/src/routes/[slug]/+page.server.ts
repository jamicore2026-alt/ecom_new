import { storefrontApi } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const featured = await storefrontApi.products(fetch, params.slug, { limit: 8, sort: 'newest' })
		return { featured: featured.items }
	} catch {
		return { featured: [] }
	}
}
