<script lang="ts">
	import ProductListing from '$lib/components/ProductListing.svelte'
	import { t } from '$lib/i18n'
	import { siteUrl } from '$lib/seo'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
</script>

<svelte:head>
	<title>{t('navigation.shop')} — {store.settings.name}</title>
	<meta name="description" content={t('products.browse', { count: data.products.meta.total, store: store.settings.name })} />
	<link rel="canonical" href={`${siteUrl(data.origin)}/${data.slug}/products`} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={`${t('navigation.shop')} — ${store.settings.name}`} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-10">
	<h1 class="text-3xl font-bold text-gray-900">{t('navigation.shop')}</h1>
	<p class="mt-2 text-gray-600">{data.products.meta.total} {t('home.products')}</p>

	<form
		method="get"
		action={`/${data.slug}/products`}
		class="mt-6 flex flex-wrap items-end gap-3"
	>
		<label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
			{t('products.sort')}
			<select
				name="sort"
				value={data.query.sort ?? ''}
				class="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"
			>
				<option value="">{t('product_list.newest')}</option>
				<option value="price_asc">{t('product_list.priceLowToHigh')}</option>
				<option value="price_desc">{t('product_list.priceHighToLow')}</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
			{t('products.minPrice')}
			<input
				type="number"
				name="minPrice"
				min="0"
				step="0.01"
				value={data.query.minPrice ?? ''}
				placeholder="0"
				class="h-10 w-28 rounded-lg border border-gray-300 px-3 text-sm"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
			{t('products.maxPrice')}
			<input
				type="number"
				name="maxPrice"
				min="0"
				step="0.01"
				value={data.query.maxPrice ?? ''}
				placeholder={t('products.any')}
				class="h-10 w-28 rounded-lg border border-gray-300 px-3 text-sm"
			/>
		</label>
		<button
			type="submit"
			class="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
		>
			{t('products.apply')}
		</button>
	</form>

	<div class="mt-8">
		<ProductListing
			page={data.products}
			storeSlug={data.slug}
			currency={store.merchant.currency}
			basePath={`/${data.slug}/products`}
			query={data.query}
		/>
	</div>
</div>
