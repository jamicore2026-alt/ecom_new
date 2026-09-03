import type { Handle } from '@sveltejs/kit'

export const handle: Handle = ({ event, resolve }) => {
	const locale = event.cookies.get('locale') === 'ar' ? 'ar' : 'en'
	const dir = locale === 'ar' ? 'rtl' : 'ltr'
	return resolve(event, {
		transformPageChunk: ({ html }) =>
			String(html).replace(/<html([^>]*)>/, (_, attrs: string) =>
				`<html${attrs.replace(/\s+lang="[^"]*"|\s+dir="[^"]*"/gi, '')} lang="${locale}" dir="${dir}">`
			)
	})
}