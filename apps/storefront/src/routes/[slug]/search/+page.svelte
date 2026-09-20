<script lang="ts">
	import ProductListing from '$lib/components/ProductListing.svelte'
	import { t } from '$lib/i18n'
	import { siteUrl } from '$lib/seo'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const title = $derived(
		data.query
			? `${t('search.resultsFor', { query: data.query })} — ${store.settings.name}`
			: `${t('search.title')} — ${store.settings.name}`
	)
	const description = $derived(
		data.query
			? t('search.resultsFor', { query: data.query })
			: t('search.title')
	)
	const canonical = $derived(
		`${siteUrl(data.origin)}/${data.slug}/search${data.query ? `?q=${encodeURIComponent(data.query)}` : ''}`
	)
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={store.settings.name} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-10">
	<h1 class="text-3xl font-bold text-neutral-900">
		{#if data.query}
			{t('search.resultsFor', { query: data.query })}
		{:else}
			{t('search.title')}
		{/if}
	</h1>
	<p class="mt-2 text-neutral-600">{data.products.meta.total} {t('home.products')}</p>

	<form method="get" action={`/${data.slug}/search`} class="mt-6 flex max-w-md items-center gap-2">
		<input
			type="search"
			name="q"
			value={data.query}
			placeholder={t('navigation.searchPlaceholder')}
			aria-label={t('navigation.searchPlaceholder')}
			class="h-11 flex-1 rounded-lg border border-neutral-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
		/>
		<button
			type="submit"
			class="h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
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
