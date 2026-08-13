import { error } from '@sveltejs/kit'
import { storefrontApi } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const order = await storefrontApi.order(fetch, params.slug, params.orderNumber)
		return { order }
	} catch {
		throw error(404, 'Order not found')
	}
}
