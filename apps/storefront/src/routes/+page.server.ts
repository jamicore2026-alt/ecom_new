import { redirect } from '@sveltejs/kit'
import { defaultStoreSlug } from '$lib/config'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
	throw redirect(307, `/${defaultStoreSlug}`)
}
