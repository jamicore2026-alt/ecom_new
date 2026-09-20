<script lang="ts">
	import ProductListing from '$lib/components/ProductListing.svelte'
	import { t, localized } from '$lib/i18n'
	import { siteUrl } from '$lib/seo'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const category = $derived(data.categories.find((c) => c.slug === data.category))
	const title = $derived(category ? localized(category.name, category.nameAr) : t('categories.title'))
	const canonical = $derived(`${siteUrl(data.origin)}/${data.slug}/categories/${data.category}`)
	const description = $derived(t('categories.browse', { title, store: store.settings.name }))
	const orgJsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'Organization',
			name: store.settings.name,
			url: `${siteUrl(data.origin)}/${data.slug}`
		}).replace(/</g, '\\u003c')
	)
	const crumbJsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: t('navigation.home'), item: `${siteUrl(data.origin)}/${data.slug}` },
				{ '@type': 'ListItem', position: 2, name: t('navigation.shop'), item: `${siteUrl(data.origin)}/${data.slug}/products` },
				{ '@type': 'ListItem', position: 3, name: title, item: canonical }
			]
		}).replace(/</g, '\\u003c')
	)
</script>

<svelte:head>
	<title>{title} — {store.settings.name}</title>
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
	{@html `<script type="application/ld+json">${orgJsonLd}</script>`}
	{@html `<script type="application/ld+json">${crumbJsonLd}</script>`}
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-10">
	<nav class="text-sm text-neutral-500">
		<a href={`/${data.slug}`} class="hover:text-neutral-900">{t('navigation.home')}</a>
		<span class="mx-2">/</span>
		<a href={`/${data.slug}/products`} class="hover:text-neutral-900">{t('navigation.shop')}</a>
		<span class="mx-2">/</span>
		<span class="text-neutral-900">{localized(category?.name ?? '', category?.nameAr) || data.category}</span>
	</nav>

	<h1 class="mt-4 text-3xl font-bold text-neutral-900">{localized(category?.name ?? '', category?.nameAr) || data.category}</h1>
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
