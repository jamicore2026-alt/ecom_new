<script lang="ts">
	import ProductCard from '$lib/components/ProductCard.svelte'
	import { cart } from '$lib/cart.svelte'
	import { account } from '$lib/account.svelte'
	import { storefrontApi } from '$lib/api'
	import { money, inStock, placeholderImage, handleImageError } from '$lib/format'
	import { track } from '$lib/analytics'
	import { absoluteImageUrl, metaDescription, siteUrl } from '$lib/seo'
	import { untrack } from 'svelte'
	import type { ProductReview, ProductVariant } from '$lib/types'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const product = $derived(data.product)

	const canonicalUrl = $derived(
		`${siteUrl(data.origin)}/${data.slug}/products/${product.slug}`
	)
	const ogImage = $derived(absoluteImageUrl(product.images?.[0] ?? product.image, data.origin))
	const description = $derived(metaDescription(product.description, `Buy ${product.name} at ${store.settings.name}.`))

	const optionNames = $derived(
		product.variants.length > 1
			? [...new Set(product.variants.flatMap((v) => Object.keys(v.optionValues ?? {})))]
			: []
	)

	const defaultVariantId = () =>
		untrack(() => (data.product.variants.length ? data.product.variants[0].id : null))

	let selectedVariantId = $state<string | null>(defaultVariantId())
	let quantity = $state(1)
	let notice = $state('')
	let activeImage = $state(0)

	let reviews = $state<ProductReview[]>([])
	let reviewsPage = $state(1)
	let reviewsTotalPages = $state(1)
	let loadingMore = $state(false)
	let formRating = $state(0)
	let formTitle = $state('')
	let formBody = $state('')
	let reviewNotice = $state('')
	let reviewError = $state('')
	let submittingReview = $state(false)
	let accountReady = $state(false)
	let wishBusy = $state(false)
	let wishError = $state('')

	$effect(() => {
		void data.product.id
		selectedVariantId = defaultVariantId()
		quantity = 1
		notice = ''
		activeImage = 0
		reviews = data.reviews?.items ?? []
		reviewsPage = data.reviews?.meta.page ?? 1
		reviewsTotalPages = data.reviews?.meta.totalPages ?? 1
		formRating = 0
		formTitle = ''
		formBody = ''
		reviewNotice = ''
		reviewError = ''
		wishError = ''
		account.setSlug(data.slug)
		accountReady = true
		track(data.slug, 'view')
	})

	const selectedVariant = $derived(
		product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0] ?? null
	)
	const price = $derived(selectedVariant?.price ?? product.price)
	const compareAt = $derived(selectedVariant?.compareAtPrice ?? product.compareAtPrice)
	const available = $derived(
		inStock(selectedVariant?.inventory ?? product.stock, product.trackInventory)
	)
	const stock = $derived(selectedVariant?.inventory ?? product.stock)
	const gallery = $derived(
		product.images?.length ? product.images : product.image ? [product.image] : []
	)
	const mainImage = $derived(
		selectedVariant?.image ?? gallery[activeImage] ?? gallery[0] ?? null
	)

	const jsonLd = $derived.by(() => {
		const schema: Record<string, unknown> = {
			'@context': 'https://schema.org',
			'@type': 'Product',
			name: product.name,
			description,
			url: canonicalUrl
		}
		if (ogImage) schema.image = [ogImage]
		if (product.sku) schema.sku = product.sku
		if (product.rating && product.rating.count > 0) {
			schema.aggregateRating = {
				'@type': 'AggregateRating',
				ratingValue: product.rating.average,
				reviewCount: product.rating.count
			}
		}
		schema.offers = {
			'@type': 'Offer',
			url: canonicalUrl,
			priceCurrency: store.settings.currency,
			price: (selectedVariant?.price ?? product.price).toFixed(2),
			itemCondition: 'https://schema.org/NewCondition',
			availability:
				available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
		}
		// Escape `<` so user-supplied fields can't break out of the script tag.
		return JSON.stringify(schema).replace(/</g, '\\u003c')
	})

	// When a variant carries its own photo, focus it in the gallery
	$effect(() => {
		const variantImage = selectedVariant?.image
		if (variantImage) {
			const index = gallery.indexOf(variantImage)
			if (index !== -1) activeImage = index
		}
	})

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

	const starString = (value: number) => '★★★★★'.slice(0, Math.round(value)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(value))

	const loadMoreReviews = async () => {
		if (loadingMore) return
		loadingMore = true
		try {
			const next = await storefrontApi.productReviews(fetch, data.slug, product.slug, {
				page: reviewsPage + 1,
				limit: 10
			})
			reviews = [...reviews, ...next.items]
			reviewsPage = reviewsPage + 1
			reviewsTotalPages = next.meta.totalPages
		} catch {
			// keep the current list on failure
		} finally {
			loadingMore = false
		}
	}

	const submitReview = async (event: SubmitEvent) => {
		event.preventDefault()
		reviewError = ''
		if (!formRating) {
			reviewError = 'Pick a star rating first'
			return
		}
		submittingReview = true
		try {
			const result = await account.submitReview(fetch, {
				productId: product.id,
				rating: formRating,
				title: formTitle.trim() || undefined,
				body: formBody.trim() || undefined
			})
			formTitle = ''
			formBody = ''
			reviewNotice =
				result.status === 'approved'
					? 'Thanks! Your review is live.'
					: 'Thanks! Your review was submitted and will appear once the store approves it.'
		} catch (e) {
			reviewError = e instanceof Error ? e.message : 'Could not submit your review'
		} finally {
			submittingReview = false
		}
	}

	const toggleWishlist = async () => {
		if (wishBusy) return
		wishBusy = true
		wishError = ''
		try {
			if (account.isWishlisted(product.id)) {
				await account.removeFromWishlist(fetch, product.id)
			} else {
				await account.addToWishlist(fetch, product.id)
			}
		} catch (e) {
			if (account.isAuthError(e)) account.logout()
			else wishError = e instanceof Error ? e.message : 'Could not update your wishlist'
		} finally {
			wishBusy = false
		}
	}

	const formatDate = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
</script>

<svelte:head>
	<title>{product.name} — {store.settings.name}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:type" content="product" />
	<meta property="og:site_name" content={store.settings.name} />
	<meta property="og:title" content={product.name} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonicalUrl} />
	{#if ogImage}
		<meta property="og:image" content={ogImage} />
	{/if}
	{#if available}
		<meta property="product:price:amount" content={price.toFixed(2)} />
		<meta property="product:price:currency" content={store.settings.currency} />
	{/if}
	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

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
	<div class="space-y-3">
		<div class="aspect-square overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
			<img src={mainImage ?? placeholderImage()} alt={product.name} class="h-full w-full object-cover" onerror={handleImageError} />
		</div>
		{#if gallery.length > 1}
			<div class="flex flex-wrap gap-2">
				{#each gallery as img, i (img + i)}
					<button
						type="button"
						class="h-16 w-16 overflow-hidden rounded-lg border-2 transition
							{mainImage === img ? 'border-indigo-600' : 'border-gray-200 hover:border-gray-300'}"
						onclick={() => (activeImage = i)}
						aria-label={`View image ${i + 1}`}
					>
						<img src={img} alt="" class="h-full w-full object-cover" onerror={handleImageError} />
					</button>
				{/each}
			</div>
		{/if}
	</div>

		<div class="flex flex-col gap-5">
			<h1 class="text-3xl font-bold text-gray-900">{product.name}</h1>

			{#if product.rating && product.rating.count > 0}
				<a href="#reviews" class="flex items-center gap-2 text-sm">
					<span class="text-amber-500" aria-hidden="true">{starString(product.rating.average)}</span>
					<span class="text-gray-500">{product.rating.average} · {product.rating.count} review{product.rating.count === 1 ? '' : 's'}</span>
				</a>
			{/if}

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

				{#if accountReady && account.signedIn}
					<button
						type="button"
						class="rounded-lg border px-4 py-3 text-xl leading-none transition
							{account.isWishlisted(product.id)
								? 'border-rose-200 bg-rose-50 text-rose-600'
								: 'border-gray-300 text-gray-400 hover:border-rose-300 hover:text-rose-500'}
							disabled:cursor-not-allowed disabled:opacity-50"
						disabled={wishBusy}
						aria-pressed={account.isWishlisted(product.id)}
						aria-label={account.isWishlisted(product.id) ? 'Remove from wishlist' : 'Save to wishlist'}
						onclick={toggleWishlist}
					>
						{account.isWishlisted(product.id) ? '♥' : '♡'}
					</button>
				{/if}
			</div>

			{#if wishError}
				<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{wishError}</p>
			{/if}

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

	<section id="reviews" class="mt-16 scroll-mt-24">
		<h2 class="text-2xl font-bold text-gray-900">Reviews</h2>

		<div class="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-5">
			<div class="lg:col-span-2">
				<div class="rounded-2xl border border-gray-200 bg-white p-6">
					{#if product.rating && product.rating.count > 0}
						<p class="text-4xl font-bold text-gray-900">{product.rating.average}</p>
						<p class="mt-1 text-amber-500" aria-hidden="true">{starString(product.rating.average)}</p>
						<p class="mt-1 text-sm text-gray-500">
							Based on {product.rating.count} review{product.rating.count === 1 ? '' : 's'}
						</p>
					{:else}
						<p class="text-sm text-gray-500">No reviews yet — be the first to review this product.</p>
					{/if}

					<div class="mt-6 border-t border-gray-100 pt-5">
						{#if accountReady && account.signedIn && account.customer}
							<h3 class="text-sm font-semibold text-gray-900">Write a review</h3>
							<form class="mt-3 space-y-3" onsubmit={submitReview}>
								<div class="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
									{#each [1, 2, 3, 4, 5] as starValue (starValue)}
										<button
											type="button"
											role="radio"
											aria-checked={formRating === starValue}
											aria-label={`${starValue} star${starValue === 1 ? '' : 's'}`}
											class="text-2xl leading-none transition {formRating >= starValue
												? 'text-amber-500'
												: 'text-gray-300 hover:text-amber-400'}"
											onclick={() => (formRating = starValue)}
										>
											★
										</button>
									{/each}
								</div>
								<input
									type="text"
									bind:value={formTitle}
									placeholder="Headline (optional)"
									maxlength="255"
									class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
								/>
								<textarea
									bind:value={formBody}
									rows="3"
									placeholder="What did you like or dislike? (optional)"
									class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
								></textarea>
								{#if reviewError}
									<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{reviewError}</p>
								{/if}
								<button
									type="submit"
									disabled={submittingReview}
									class="w-full rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
								>
									{submittingReview ? 'Submitting…' : 'Submit review'}
								</button>
							</form>
							{#if reviewNotice}
								<p class="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">{reviewNotice}</p>
							{/if}
							<p class="mt-2 text-xs text-gray-400">
								Reviews are published after the store approves them.
							</p>
						{:else if accountReady}
							<p class="text-sm text-gray-500">
								<a href={`/${data.slug}/account`} class="font-medium text-indigo-600 hover:text-indigo-700">Sign in</a>
								to write a review.
							</p>
						{/if}
					</div>
				</div>
			</div>

			<div class="lg:col-span-3">
				{#if reviews.length === 0}
					<p class="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
						Questions about this product? Contact the store directly.
					</p>
				{:else}
					<ul class="space-y-4">
						{#each reviews as review (review.id)}
							<li class="rounded-2xl border border-gray-200 bg-white p-5">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span class="text-sm font-semibold text-amber-500" aria-hidden="true">{starString(review.rating)}</span>
									<span class="text-sm font-medium text-gray-900">{review.title ?? ''}</span>
									{#if review.verifiedPurchase}
										<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
											Verified purchase
										</span>
									{/if}
									<span class="ml-auto text-xs text-gray-400">{formatDate(review.createdAt)}</span>
								</div>
								{#if review.body}
									<p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-600">{review.body}</p>
								{/if}
								<p class="mt-2 text-xs text-gray-400">{review.authorName}</p>
							</li>
						{/each}
					</ul>
					{#if reviewsPage < reviewsTotalPages}
						<button
							type="button"
							class="mt-4 w-full rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
							disabled={loadingMore}
							onclick={loadMoreReviews}
						>
							{loadingMore ? 'Loading…' : 'Load more reviews'}
						</button>
					{/if}
				{/if}
			</div>
		</div>
	</section>

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
