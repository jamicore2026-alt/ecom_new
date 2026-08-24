<script lang="ts">
	import { ApiError } from '$lib/api'
	import { account } from '$lib/account.svelte'
	import { cart } from '$lib/cart.svelte'
	import { money } from '$lib/format'
	import type { WishListItem } from '$lib/types'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)

	$effect(() => {
		account.setSlug(slug)
		account.ensureWishlist(fetch)
	})

	let busyId = $state('')
	let notice = $state('')

	async function addToCart(item: WishListItem) {
		if (busyId) return
		busyId = item.productId
		notice = ''
		try {
			cart.add({
				productId: item.productId,
				variantId: item.variantId,
				name: item.name,
				sku: null,
				price: item.price,
				compareAtPrice: item.compareAtPrice,
				image: item.image,
				optionValues: {},
				quantity: 1
			})
			notice = `Added “${item.name}” to your cart`
		} finally {
			busyId = ''
		}
	}

	async function removeItem(item: WishListItem) {
		if (busyId) return
		busyId = item.productId
		notice = ''
		try {
			await account.removeFromWishlist(fetch, item.productId)
		} catch (e) {
			if (account.isAuthError(e)) {
				account.logout()
				return
			}
			notice = e instanceof ApiError ? e.message : 'Could not update your wishlist'
		} finally {
			busyId = ''
		}
	}
</script>

<svelte:head>
	<title>Wishlist · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-10">
	{#if !account.signedIn}
		<div class="mx-auto max-w-md rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
			<h1 class="text-xl font-bold text-gray-900">Sign in to see your wishlist</h1>
			<p class="mt-2 text-sm text-gray-500">Save products you love and find them here anytime.</p>
			<a
				href={`/${slug}/account`}
				class="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				Sign in or create an account
			</a>
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">Wishlist</h1>
				<p class="mt-1 text-sm text-gray-500">
					{account.wishlist.length}
					saved {account.wishlist.length === 1 ? 'product' : 'products'}
				</p>
			</div>
			<a href={`/${slug}/products`} class="text-sm font-medium text-indigo-600 hover:text-indigo-700">
				Continue shopping
			</a>
		</div>

		{#if notice}
			<p class="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</p>
		{/if}

		{#if account.wishlist.length === 0}
			<div class="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
				<p class="text-sm text-gray-500">Nothing saved yet — tap the heart on any product to save it.</p>
				<a
					href={`/${slug}/products`}
					class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Browse products
				</a>
			</div>
		{:else}
			<ul class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each account.wishlist as item (item.productId)}
					<li class="flex overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:border-indigo-300 hover:shadow-sm">
						<a href={`/${slug}/products/${item.slug}`} class="w-24 shrink-0 bg-gray-100 sm:w-28">
							{#if item.image}
								<img src={item.image} alt={item.name} class="h-full w-full object-cover" loading="lazy" />
							{:else}
								<span class="flex h-full w-full items-center justify-center text-xl text-gray-300">✦</span>
							{/if}
						</a>
						<div class="flex min-w-0 flex-1 flex-col p-4">
							<a href={`/${slug}/products/${item.slug}`} class="truncate text-sm font-semibold text-gray-900 hover:text-indigo-600">
								{item.name}
							</a>
							<p class="mt-1 text-sm font-semibold text-gray-900">
								{money(item.price, data.store.merchant.currency)}
								{#if item.compareAtPrice !== null && item.compareAtPrice > item.price}
									<span class="ml-1 text-xs font-normal text-gray-400 line-through">
										{money(item.compareAtPrice, data.store.merchant.currency)}
									</span>
								{/if}
							</p>
							<p class="mt-1 text-xs {item.stock > 0 ? 'text-gray-400' : 'font-medium text-red-600'}">
								{item.stock > 0 ? `${item.stock} in stock` : 'Out of stock'}
							</p>
							<div class="mt-auto flex items-center gap-2 pt-3">
								<button
									type="button"
									disabled={item.stock <= 0 || busyId === item.productId}
									onclick={() => addToCart(item)}
									class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
								>
									Add to cart
								</button>
								<button
									type="button"
									disabled={busyId === item.productId}
									onclick={() => removeItem(item)}
									class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
								>
									Remove
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
