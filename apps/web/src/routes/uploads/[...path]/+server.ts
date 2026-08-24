import type { RequestHandler } from './$types'
import { proxyToApi } from '$lib/server/api-proxy'

const passthrough: RequestHandler = (event) =>
	proxyToApi(event.request, `/uploads/${event.params.path}`, event.url.search)

export const GET = passthrough
export const HEAD = passthrough
