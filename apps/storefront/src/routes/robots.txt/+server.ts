import { siteUrl } from '$lib/seo'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const base = siteUrl(url.origin)

	const body = [
		'User-agent: *',
		'Allow: /',
		'Disallow: /*/cart',
		'Disallow: /*/checkout',
		'Disallow: /*/orders',
		'',
		`Sitemap: ${base}/sitemap.xml`,
		''
	].join('\n')

	setHeaders({ 'content-type': 'text/plain; charset=utf-8' })
	return new Response(body)
}
