import { storefrontApi, loadError } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const order = await storefrontApi.order(fetch, params.slug, params.orderNumber)
		return { order }
	} catch (err) {
		loadError(err, 'Order not found')
	}
}
