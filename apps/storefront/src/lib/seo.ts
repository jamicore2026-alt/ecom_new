import { env } from '$env/dynamic/public'

/** Public base URL for canonical/OG/sitemap links (no trailing slash). */
export function siteUrl(origin: string): string {
	return (env.PUBLIC_STOREFRONT_URL || origin).replace(/\/+$/, '')
}

/** Resolve a stored image path to an absolute URL suitable for OG / JSON-LD. */
export function absoluteImageUrl(url: string | null | undefined, origin: string): string | null {
	if (!url) return null
	if (/^https?:\/\//i.test(url)) return url
	const apiBase = (env.PUBLIC_API_URL || 'http://localhost:3005').replace(/\/+$/, '')
	return `${apiBase}${url.startsWith('/') ? url : `/${url}`}`
}

export function metaDescription(text: string | null | undefined, fallback: string): string {
	const clean = (text ?? '').replace(/\s+/g, ' ').trim()
	if (!clean) return fallback
	return clean.length > 155 ? `${clean.slice(0, 152)}...` : clean
}
