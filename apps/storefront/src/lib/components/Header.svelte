<script lang="ts">
	import { cart } from '$lib/cart.svelte'
	import { account } from '$lib/account.svelte'
	import { handleImageError } from '$lib/format'
	import type { Category, StoreInfo } from '$lib/types'

	interface Props {
		slug: string
		store: StoreInfo
		categories: Category[]
	}

	let { slug, store, categories }: Props = $props()

	let menuOpen = $state(false)

	$effect(() => {
		cart.setSlug(slug)
		account.setSlug(slug)
		account.ensureWishlist(fetch)
	})
</script>

{#if store.settings.announcement}
	<div class="bg-gray-900 px-4 py-2 text-center text-xs font-medium text-white">
		{store.settings.announcement}
	</div>
{/if}

<header class="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
	<div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
		<a href={`/${slug}`} class="flex min-w-0 items-center gap-2">
			{#if store.settings.logo}
				<img
					src={store.settings.logo}
					alt={store.settings.name}
					class="h-9 w-9 rounded-full object-cover"
					onerror={handleImageError}
				/>
			{:else}
				<span
					class="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white"
				>
					{store.settings.name.charAt(0)}
				</span>
			{/if}
			<span class="truncate text-lg font-semibold tracking-tight text-gray-900">
				{store.settings.name}
			</span>
		</a>

		<nav class="hidden items-center gap-6 text-sm font-medium text-gray-700 lg:flex">
			<a href={`/${slug}`} class="hover:text-gray-900">Home</a>
			<a href={`/${slug}/products`} class="hover:text-gray-900">Shop</a>
			{#if categories.length}
				<div class="group relative">
					<button class="cursor-pointer hover:text-gray-900">Categories</button>
					<div
						class="invisible absolute left-0 top-full z-50 w-56 rounded-lg border border-gray-200 bg-white py-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100"
					>
						{#each categories as cat}
							<a
								href={`/${slug}/categories/${cat.slug}`}
								class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900"
							>
								{cat.name} <span class="text-gray-400">({cat.productCount})</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		</nav>

		<div class="flex items-center gap-2 sm:gap-3">
			<form
				action={`/${slug}/search`}
				method="get"
				class="hidden items-center gap-2 lg:flex"
				role="search"
			>
				<input
					type="search"
					name="q"
					placeholder="Search products"
					class="h-10 w-40 rounded-full border border-gray-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 lg:w-56"
				/>
				<button
					type="submit"
					class="h-10 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Search
				</button>
			</form>
			<a
				href={`/${slug}/account`}
				class="flex h-11 items-center gap-1 rounded-full border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
			>
				{#if account.signedIn && account.customer}
					{account.customer.firstName || 'Account'}
				{:else}
					Sign in
				{/if}
			</a>
			<a
				href={`/${slug}/wishlist`}
				class="relative flex h-11 items-center gap-1 rounded-full border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
			>
				Wishlist
				{#if account.wishlist.length > 0}
					<span
						class="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white"
					>
						{account.wishlist.length}
					</span>
				{/if}
			</a>
			<a
				href={`/${slug}/cart`}
				class="relative flex h-11 items-center gap-1 rounded-full border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
			>
				Cart
				{#if cart.count > 0}
					<span
						class="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white"
					>
						{cart.count}
					</span>
				{/if}
			</a>
			<button
				class="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 lg:hidden"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
			>
				<svg
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					{#if menuOpen}
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					{:else}
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
					{/if}
				</svg>
			</button>
		</div>
	</div>

	{#if menuOpen}
		<div class="border-t border-gray-100 bg-white px-4 py-4 shadow-md lg:hidden">
			<form action={`/${slug}/search`} method="get" class="mb-4 flex items-center gap-2" role="search">
				<input
					type="search"
					name="q"
					placeholder="Search products"
					class="h-10 flex-1 rounded-full border border-gray-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
				/>
				<button
					type="submit"
					class="h-10 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Search
				</button>
			</form>
			<nav class="flex flex-col text-sm font-medium text-gray-700">
				<a href={`/${slug}`} class="border-b border-gray-100 px-2 py-3 hover:text-gray-900">Home</a>
				<a href={`/${slug}/products`} class="border-b border-gray-100 px-2 py-3 hover:text-gray-900">Shop</a>
				{#if categories.length}
					<p class="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Categories</p>
					{#each categories as cat}
						<a
							href={`/${slug}/categories/${cat.slug}`}
							class="px-2 py-2.5 hover:text-gray-900"
						>
							{cat.name} <span class="text-gray-400">({cat.productCount})</span>
						</a>
					{/each}
				{/if}
			</nav>
		</div>
	{/if}
</header>
