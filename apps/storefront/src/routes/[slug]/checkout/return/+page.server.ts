import { error, redirect } from '@sveltejs/kit'
import { ApiError, storefrontApi } from '$lib/api'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ fetch, params, url }) => {
	const orderNumber = url.searchParams.get('order')
	const paymentId = url.searchParams.get('paymentId') ?? undefined
	if (!orderNumber) error(400, 'Missing order reference')

	let result = null
	let errorMessage = ''
	try {
		result = await storefrontApi.syncOrder(fetch, params.slug, orderNumber, paymentId ? { paymentId } : {})
	} catch (e) {
		errorMessage =
			e instanceof ApiError
				? e.status === 404
					? 'We could not find this order.'
					: e.message
				: 'Could not verify your payment right now.'
	}

	if (result?.paymentStatus === 'paid') {
		redirect(303, `/${params.slug}/orders/${encodeURIComponent(orderNumber)}`)
	}

	return {
		slug: params.slug,
		orderNumber,
		paymentStatus: result?.paymentStatus ?? 'unknown',
		errorMessage
	}
}
