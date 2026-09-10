<script lang="ts">
	import ProductListing from '$lib/components/ProductListing.svelte'
	import { t } from '$lib/i18n'
	import { siteUrl } from '$lib/seo'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const category = $derived(data.categories.find((c) => c.slug === data.category))
	const title = $derived(category ? category.name : t('categories.title'))
</script>

<svelte:head>
	<title>{title} — {store.settings.name}</title>
	<meta name="description" content={t('categories.browse', { title, store: store.settings.name })} />
	<link rel="canonical" href={`${siteUrl(data.origin)}/${data.slug}/categories/${data.category}`} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-10">
	<nav class="text-sm text-neutral-500">
		<a href={`/${data.slug}`} class="hover:text-neutral-900">{t('navigation.home')}</a>
		<span class="mx-2">/</span>
		<a href={`/${data.slug}/products`} class="hover:text-neutral-900">{t('navigation.shop')}</a>
		<span class="mx-2">/</span>
		<span class="text-neutral-900">{category?.name ?? data.category}</span>
	</nav>

	<h1 class="mt-4 text-3xl font-bold text-neutral-900">{category?.name ?? data.category}</h1>
	<p class="mt-2 text-neutral-600">{data.products.meta.total} {t('home.products')}</p>

	<div class="mt-8">
		<ProductListing
			page={data.products}
			storeSlug={data.slug}
			currency={store.merchant.currency}
			basePath={`/${data.slug}/categories/${data.category}`}
		/>
	</div>
</div>
