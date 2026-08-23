<script lang="ts">
	import ProductCard from '$lib/components/ProductCard.svelte'
	import { metaDescription, siteUrl } from '$lib/seo'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const description = $derived(
		metaDescription(
			store.settings.announcement,
			`Shop ${store.settings.name} — quality products at great prices, delivered to your door.`
		)
	)
</script>

<svelte:head>
	<title>{store.settings.name}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={`${siteUrl(data.origin)}/${data.slug}`} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={store.settings.name} />
	<meta property="og:title" content={store.settings.name} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={`${siteUrl(data.origin)}/${data.slug}`} />
</svelte:head>

<section class="bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
	<div class="mx-auto max-w-7xl px-4 py-20 text-center">
		<h1 class="text-4xl font-bold tracking-tight sm:text-5xl">{store.settings.name}</h1>
		<p class="mx-auto mt-4 max-w-xl text-lg text-indigo-100">
			Discover quality products at great prices, delivered to your door.
		</p>
		<a
			href={`/${data.slug}/products`}
			class="mt-8 inline-block rounded-full bg-white px-8 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
		>
			Shop now
		</a>
	</div>
</section>

<section class="mx-auto max-w-7xl px-4 py-12">
	<div class="mb-6 flex items-center justify-between">
		<h2 class="text-2xl font-bold text-gray-900">Featured products</h2>
		<a href={`/${data.slug}/products`} class="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
			View all
		</a>
	</div>
	{#if data.featured.length}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.featured as product (product.id)}
				<ProductCard product={product} storeSlug={data.slug} currency={store.merchant.currency} />
			{/each}
		</div>
	{:else}
		<p class="py-12 text-center text-gray-500">No products available yet.</p>
	{/if}
</section>

{#if data.categories.length}
	<section class="mx-auto max-w-7xl px-4 pb-12">
		<h2 class="mb-6 text-2xl font-bold text-gray-900">Shop by category</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.categories as cat (cat.id)}
				<a
					href={`/${data.slug}/categories/${cat.slug}`}
					class="rounded-xl border border-gray-200 bg-white p-6 text-center transition hover:border-indigo-300 hover:shadow"
				>
					<h3 class="font-semibold text-gray-900">{cat.name}</h3>
					<p class="mt-1 text-sm text-gray-500">{cat.productCount} products</p>
				</a>
			{/each}
		</div>
	</section>
{/if}
