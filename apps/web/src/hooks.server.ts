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
	'/settings'
]

export const handle: Handle = ({ event, resolve }) => {
	const { pathname } = event.url
	const hasSession = event.cookies.get(REFRESH_COOKIE) !== undefined
	const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

	if (isProtected && !hasSession) redirect(302, '/login')
	if (pathname === '/login' && hasSession) redirect(302, '/dashboard')

	return resolve(event)
}
