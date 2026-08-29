import { storefrontApi } from '$lib/api'
import { siteUrl } from '$lib/seo'
import type { RequestHandler } from './$types'

export const prerender = false

// Store slugs come from the API — escape before splicing into XML.
const escapeXml = (s: string) =>
	s.replace(/[<>&'"]/g, (c) =>
		({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string
	)

export const GET: RequestHandler = async ({ fetch, url, setHeaders }) => {
	const base = siteUrl(url.origin)
	const stores: Array<{ slug: string; name: string }> = await storefrontApi
		.stores(fetch)
		.catch(() => [] as Array<{ slug: string; name: string }>)

	const entries = stores
		.map(
			(s) =>
				`\t<sitemap>\n\t\t<loc>${base}/${escapeXml(s.slug)}/sitemap.xml</loc>\n\t</sitemap>`
		)
		.join('\n')

	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`

	setHeaders({
		'content-type': 'application/xml',
		'cache-control': 'public, max-age=600'
	})
	return new Response(xml)
}
