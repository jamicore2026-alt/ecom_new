import { env } from '$env/dynamic/private'
import { proxyToApi as proxy } from '@merchant-dashboard/api-proxy'

const API_ORIGIN = (env.API_ORIGIN ?? 'http://localhost:3005').replace(/\/+$/, '')

export function proxyToApi(request: Request, upstreamPath: string, search: string): Promise<Response> {
	return proxy(request, upstreamPath, search, API_ORIGIN)
}