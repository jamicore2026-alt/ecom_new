<script lang="ts">
	import ProductCard from '$lib/components/ProductCard.svelte'
	import { cart } from '$lib/cart.svelte'
	import { money, inStock, placeholderImage } from '$lib/format'
	import { untrack } from 'svelte'
	import type { ProductVariant } from '$lib/types'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const product = $derived(data.product)

	const optionNames = $derived(
		product.variants.length > 1
			? [...new Set(product.variants.flatMap((v) => Object.keys(v.optionValues ?? {})))]
			: []
	)

	const initialProduct = untrack(() => data.product)
	const initialVariantId = initialProduct.variants.length ? initialProduct.variants[0].id : null
	let selectedVariantId = $state<string | null>(initialVariantId)
	let quantity = $state(1)
	let notice = $state('')

	const selectedVariant = $derived(
		product.variants.find((v) => v.id === selectedVariantId) ?? null
	)
	const price = $derived(selectedVariant?.price ?? product.price)
	const compareAt = $derived(selectedVariant?.compareAtPrice ?? product.compareAtPrice)
	const available = $derived(
		inStock(selectedVariant?.inventory ?? product.stock, product.trackInventory)
	)
	const stock = $derived(selectedVariant?.inventory ?? product.stock)
	const image = $derived(selectedVariant?.image ?? product.image)

	const chooseOption = (name: string, value: string) => {
		const match = product.variants.find(
			(v) => v.optionValues?.[name] === value && v.id !== selectedVariantId
		)
		if (match) selectedVariantId = match.id
	}

	const addToCart = () => {
		if (!available) return
		const variant = selectedVariant ?? product.variants[0]
		cart.add({
			productId: product.id,
			variantId: variant?.id ?? product.id,
			name: product.name,
			sku: variant?.sku ?? product.sku,
			price: selectedVariant?.price ?? product.price,
			compareAtPrice: selectedVariant?.compareAtPrice ?? product.compareAtPrice,
			image: variant?.image ?? product.image,
			optionValues: variant?.optionValues ?? {},
			quantity
		})
		notice = `Added ${quantity} × ${product.name} to cart`
		quantity = 1
		setTimeout(() => (notice = ''), 3500)
	}

	const optionValues = (variant: ProductVariant, name: string) =>
		variant.optionValues?.[name] ?? ''
</script>

<div class="mx-auto max-w-7xl px-4 py-10">
	<nav class="text-sm text-gray-500">
		<a href={`/${data.slug}`} class="hover:text-gray-900">Home</a>
		<span class="mx-2">/</span>
		<a href={`/${data.slug}/products`} class="hover:text-gray-900">Shop</a>
		{#if product.category}
			<span class="mx-2">/</span>
			<a href={`/${data.slug}/categories/${product.category.slug}`} class="hover:text-gray-900">
				{product.category.name}
			</a>
		{/if}
		<span class="mx-2">/</span>
		<span class="text-gray-900">{product.name}</span>
	</nav>

	<div class="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
		<div class="aspect-square overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
			<img src={image ?? placeholderImage()} alt={product.name} class="h-full w-full object-cover" />
		</div>

		<div class="flex flex-col gap-5">
			<h1 class="text-3xl font-bold text-gray-900">{product.name}</h1>

			<div class="flex items-baseline gap-3">
				<span class="text-2xl font-semibold text-gray-900">{money(price, store.merchant.currency)}</span>
				{#if compareAt && compareAt > price}
					<span class="text-lg text-gray-400 line-through">{money(compareAt, store.merchant.currency)}</span>
				{/if}
			</div>

			{#if optionNames.length}
				{#each optionNames as name (name)}
					<div>
						<p class="text-sm font-medium text-gray-700">{name}</p>
						<div class="mt-2 flex flex-wrap gap-2">
							{#each [...new Set(product.variants.map((v) => optionValues(v, name)))] as value (value)}
								<button
									type="button"
									class="rounded-lg border px-4 py-2 text-sm font-medium transition
										{selectedVariant?.optionValues?.[name] === value
											? 'border-indigo-600 bg-indigo-600 text-white'
											: 'border-gray-300 text-gray-700 hover:border-indigo-400'}"
									onclick={() => chooseOption(name, value)}
								>
									{value}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{/if}

			<div class="flex items-center gap-4">
				<div class="flex items-center rounded-lg border border-gray-300">
					<button
						type="button"
						class="px-3 py-2 text-gray-600 hover:text-gray-900"
						onclick={() => (quantity = Math.max(1, quantity - 1))}
						aria-label="Decrease quantity"
					>
						−
					</button>
					<span class="w-10 text-center text-sm font-medium">{quantity}</span>
					<button
						type="button"
						class="px-3 py-2 text-gray-600 hover:text-gray-900"
						onclick={() => (quantity = quantity + 1)}
						aria-label="Increase quantity"
					>
						+
					</button>
				</div>

				<button
					type="button"
					class="flex-1 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
					disabled={!available}
					onclick={addToCart}
				>
					{available ? 'Add to cart' : 'Out of stock'}
				</button>
			</div>

			<p class="text-sm {available ? 'text-green-600' : 'text-red-600'}">
				{#if available}
					{stock > 0 ? `${stock} available` : 'In stock'}
				{:else}
					Out of stock
				{/if}
			</p>

			{#if notice}
				<p class="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">{notice}</p>
			{/if}

			{#if product.description}
				<div class="border-t border-gray-200 pt-5">
					<h2 class="mb-2 text-sm font-semibold text-gray-900">Description</h2>
					<p class="whitespace-pre-line text-sm leading-relaxed text-gray-600">{product.description}</p>
				</div>
			{/if}

			{#if product.sku}
				<p class="text-xs text-gray-400">SKU: {product.sku}</p>
			{/if}
		</div>
	</div>

	{#if product.related.length}
		<section class="mt-16">
			<h2 class="mb-6 text-2xl font-bold text-gray-900">You may also like</h2>
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
				{#each product.related as related (related.id)}
					<ProductCard product={related} storeSlug={data.slug} currency={store.merchant.currency} />
				{/each}
			</div>
		</section>
	{/if}
</div>
