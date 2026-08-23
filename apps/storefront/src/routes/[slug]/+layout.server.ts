import { error } from '@sveltejs/kit'
import { storefrontApi, loadError } from '$lib/api'
import type { Category } from '$lib/types'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ params, fetch }) => {
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

	return { slug, store, categories }
}
