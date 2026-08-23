import { storefrontApi } from '$lib/api'
import { siteUrl } from '$lib/seo'
import type { RequestHandler } from './$types'

const escapeXml = (s: string) =>
	s.replace(/[<>&'"]/g, (c) =>
		({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c
	)

export const GET: RequestHandler = async ({ fetch, params, url, setHeaders }) => {
	const base = siteUrl(url.origin)
	let categories: Array<{ slug: string }> = []
	let products: Array<{ slug: string }> = []
	try {
		const data = await storefrontApi.sitemap(fetch, params.slug)
		categories = data.categories
		products = data.products
	} catch {
		// Unknown store → empty sitemap rather than a 500.
	}

	const loc = (path: string) => `\t\t<loc>${base}/${params.slug}${path}</loc>`
	const urls = [
		`\t<url>\n${loc('')}\n\t</url>`,
		`\t<url>\n${loc('/products')}\n\t</url>`,
		...categories.map(
			(c) => `\t<url>\n${loc(`/categories/${escapeXml(c.slug)}`)}\n\t</url>`
		),
		...products.map(
			(p) => `\t<url>\n${loc(`/products/${escapeXml(p.slug)}`)}\n\t</url>`
		)
	].join('\n')

	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`

	setHeaders({
		'content-type': 'application/xml',
		'cache-control': 'public, max-age=600'
	})
	return new Response(xml)
}
