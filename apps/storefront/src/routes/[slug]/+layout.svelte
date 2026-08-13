<script lang="ts">
	import Header from '$lib/components/Header.svelte'
	import Footer from '$lib/components/Footer.svelte'
	import type { LayoutProps } from './$types'

	let { data, children }: LayoutProps = $props()
</script>

<Header slug={data.slug} store={data.store} categories={data.categories} />
<main class="min-h-[60vh]">
	{@render children()}
</main>
<Footer slug={data.slug} store={data.store} />
