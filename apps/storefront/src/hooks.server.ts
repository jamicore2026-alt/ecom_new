import type { Handle } from '@sveltejs/kit'

export const handle: Handle = ({ event, resolve }) => {
	const locale = event.cookies.get('locale') === 'ar' ? 'ar' : 'en'
	return resolve(event, {
		transformPageChunk: ({ html }) => {
			const h = String(html)
				.replace(/(<html[^>]*\blang=)"[^"]*"/, `$1="${locale}"`)
				.replace(/(<html[^>]*\bdir=)"[^"]*"/, `$1="${locale === 'ar' ? 'rtl' : 'ltr'}"`)
			if (h === String(html) && /<html[^>]*>$/.test(h)) {
				return h.replace(/<html[^>]*>/, `<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`)
			}
			return h
		}
	})
}