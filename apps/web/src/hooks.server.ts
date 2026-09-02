import { redirect } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit'

const REFRESH_COOKIE = 'md.refresh'

const PROTECTED_PREFIXES = [
	'/dashboard',
	'/analytics',
	'/products',
	'/inventory',
	'/orders',
	'/customers',
	'/discounts',
	'/reviews',
	'/menu',
	'/pos',
	'/food-orders',
	'/tables',
	'/kitchen',
	'/kds',
	'/delivery',
	'/audit',
	'/settings'
]

export const handle: Handle = ({ event, resolve }) => {
	const { pathname } = event.url
	const hasSession = event.cookies.get(REFRESH_COOKIE) !== undefined
	const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

	if (isProtected && !hasSession) redirect(302, '/login')
	if (pathname === '/login' && hasSession) redirect(302, '/dashboard')

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
