<script lang="ts">
	import ProductListing from '$lib/components/ProductListing.svelte'
	import { t } from '$lib/i18n'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
</script>

<svelte:head>
	<title>{t('search.title')} — {store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-10">
	<h1 class="text-3xl font-bold text-gray-900">
		{#if data.query}
			{t('search.resultsFor', { query: data.query })}
		{:else}
			{t('search.title')}
		{/if}
	</h1>
	<p class="mt-2 text-gray-600">{data.products.meta.total} {t('home.products')}</p>

	<form method="get" action={`/${data.slug}/search`} class="mt-6 flex max-w-md items-center gap-2">
		<input
			type="search"
			name="q"
			value={data.query}
			placeholder={t('navigation.searchPlaceholder')}
			class="h-10 flex-1 rounded-lg border border-gray-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
		/>
		<button
			type="submit"
			class="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
		>
			{t('navigation.search')}
		</button>
	</form>

	<div class="mt-8">
		<ProductListing
			page={data.products}
			storeSlug={data.slug}
			currency={store.merchant.currency}
			basePath={`/${data.slug}/search`}
			query={data.query ? { q: data.query } : {}}
		/>
	</div>
</div>
