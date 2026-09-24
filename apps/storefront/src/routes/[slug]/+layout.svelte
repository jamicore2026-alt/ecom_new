<script lang="ts">
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import Header from '$lib/components/Header.svelte'
	import Footer from '$lib/components/Footer.svelte'
	import type { LayoutProps } from './$types'

	let { data, children }: LayoutProps = $props()

	// Affiliate attribution: persist ?ref=<code> for checkout (30-day window).
	$effect(() => {
		if (!browser) return
		const ref = page.url.searchParams.get('ref')?.trim()
		if (!ref) return
		try {
			localStorage.setItem(
				'ecom:ref',
				JSON.stringify({ code: ref.slice(0, 50), at: Date.now() })
			)
		} catch {
			/* storage unavailable — checkout proceeds unattributed */
		}
	})
</script>

<Header slug={data.slug} store={data.store} categories={data.categories} />
<main class="min-h-[60vh]">
	{@render children()}
</main>
<Footer slug={data.slug} store={data.store} />
