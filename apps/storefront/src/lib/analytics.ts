import { browser } from '$app/environment'

export type FunnelEvent = 'view' | 'cart_add' | 'checkout_start'

/** Fire-and-forget funnel tracking; safe to call anywhere, no-ops on the server. */
export function track(slug: string, type: FunnelEvent): void {
	if (!browser) return
	fetch(`/api/store/${slug}/events`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type }),
		keepalive: true
	}).catch(() => {})
}
