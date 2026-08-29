import type { RequestHandler } from './$types'
import { proxyToApi } from '$lib/server/api-proxy'

const passthrough =
	(_method: string): RequestHandler =>
	(event) =>
		proxyToApi(event.request, `/api/${event.params.path}`, event.url.search)

export const GET = passthrough('GET')
export const POST = passthrough('POST')
export const PUT = passthrough('PUT')
export const PATCH = passthrough('PATCH')
export const DELETE = passthrough('DELETE')
export const OPTIONS = passthrough('OPTIONS')
export const HEAD = passthrough('HEAD')
