import { storefrontApi } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch }) => {
	const product = await storefrontApi.product(fetch, params.slug, params.product)
	return { product }
}
