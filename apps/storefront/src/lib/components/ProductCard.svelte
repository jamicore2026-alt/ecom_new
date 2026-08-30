<script lang="ts">
	import type { ProductSummary } from '$lib/types'
	import { money, inStock, placeholderImage } from '$lib/format'

	interface Props {
		product: ProductSummary
		storeSlug: string
		currency?: string
	}

	let { product, storeSlug, currency = 'USD' }: Props = $props()

	const available = $derived(inStock(product.stock, product.trackInventory))
</script>

<a
	href={`/${storeSlug}/products/${product.slug}`}
	class="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:shadow-lg"
>
	<div class="relative aspect-square overflow-hidden bg-gray-100">
		<img
			src={product.image ?? placeholderImage()}
			alt={product.name}
			class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
			loading="lazy"
		/>
		{#if product.compareAtPrice && product.compareAtPrice > product.price}
			<span
				class="absolute left-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white"
			>
				Sale
			</span>
		{/if}
	</div>

	<div class="flex flex-1 flex-col gap-1 p-4">
		<p class="text-xs text-gray-500">{product.category?.name ?? 'General'}</p>
		<h2 class="line-clamp-2 text-sm font-medium text-gray-900 group-hover:underline">
			{product.name}
		</h2>
		<div class="mt-auto flex items-baseline gap-2 pt-2">
			<span class="text-base font-semibold text-gray-900">{money(product.price, currency)}</span>
			{#if product.compareAtPrice && product.compareAtPrice > product.price}
				<span class="text-sm text-gray-400 line-through">{money(product.compareAtPrice, currency)}</span>
			{/if}
		</div>
		<p
			class="text-xs {available
				? 'text-green-600'
				: 'text-red-600'}"
		>
			{#if available}
				{product.stock > 0 ? `${product.stock} in stock` : 'In stock'}
			{:else}
				Out of stock
			{/if}
		</p>
	</div>
</a>
