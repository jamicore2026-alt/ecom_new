import { browser } from '$app/environment'

export type FunnelEvent = 'view' | 'cart_add' | 'checkout_start'

/**
 * Coarse acquisition channel for funnel attribution — must stay aligned with
 * the API's FUNNEL_CHANNELS allowlist (invalid values fall back to 'direct').
 */
function detectChannel(): string {
	if (!browser) return 'direct'
	try {
		const params = new URLSearchParams(window.location.search)
		const medium = (params.get('utm_medium') ?? '').toLowerCase()
		if (params.has('gclid') || params.get('utm_source') === 'google-ads') return 'paid'
		if (medium.includes('cpc') || medium.includes('ppc') || medium === 'paid') return 'paid'
		if (medium.includes('email')) return 'email'
		if (medium.includes('social')) return 'social'
		if (document.referrer) {
			const host = new URL(document.referrer).hostname
			if (host && host !== window.location.hostname) return 'referral'
		}
	} catch {
		// fall through to direct
	}
	return 'direct'
}

/** Fire-and-forget funnel tracking; safe to call anywhere, no-ops on the server. */
export function track(slug: string, type: FunnelEvent): void {
	if (!browser) return
	fetch(`/api/store/${encodeURIComponent(slug)}/events`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ type, channel: detectChannel() }),
		keepalive: true
	}).catch(() => {})
}
