import { storefrontApi, loadError } from '$lib/api'
import type { Category } from '$lib/types'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ params, fetch, url, setHeaders }) => {
	const { slug } = params
	let store
	try {
		store = await storefrontApi.info(fetch, slug)
	} catch (e) {
		loadError(e, 'Store not found')
	}

	let categories: Category[] = []
	try {
		const tree = await storefrontApi.categories(fetch, slug)
		categories = tree.items
	} catch {
		// categories are optional for rendering
	}

	// Store info + categories change rarely — short cache with SWR keeps
	// navigation snappy without serving stale storefronts for long.
	setHeaders({ 'cache-control': 'public, max-age=120, stale-while-revalidate=600' })

	return { slug, store, categories, origin: url.origin }
}
