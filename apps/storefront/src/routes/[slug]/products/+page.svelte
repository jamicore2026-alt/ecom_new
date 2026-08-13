<script lang="ts">
	import ProductListing from '$lib/components/ProductListing.svelte'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
</script>

<div class="mx-auto max-w-7xl px-4 py-10">
	<h1 class="text-3xl font-bold text-gray-900">Shop</h1>
	<p class="mt-2 text-gray-600">{data.products.meta.total} products</p>

	<form
		method="get"
		action={`/${data.slug}/products`}
		class="mt-6 flex flex-wrap items-end gap-3"
	>
		<label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
			Sort
			<select
				name="sort"
				value={data.query.sort ?? ''}
				class="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"
			>
				<option value="">Newest</option>
				<option value="price_asc">Price: Low to High</option>
				<option value="price_desc">Price: High to Low</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs font-medium text-gray-600">
			Min price
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
			Max price
			<input
				type="number"
				name="maxPrice"
				min="0"
				step="0.01"
				value={data.query.maxPrice ?? ''}
				placeholder="Any"
				class="h-10 w-28 rounded-lg border border-gray-300 px-3 text-sm"
			/>
		</label>
		<button
			type="submit"
			class="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
		>
			Apply
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
