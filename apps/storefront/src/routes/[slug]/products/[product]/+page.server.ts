import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const product = await storefrontApi.product(fetch, params.slug, params.product)
		return { product }
	} catch (e) {
		loadError(e, 'Product not found')
	}
}
