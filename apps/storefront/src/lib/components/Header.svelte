<script lang="ts">
	import { cart } from '$lib/cart.svelte'
	import type { Category, StoreInfo } from '$lib/types'

	interface Props {
		slug: string
		store: StoreInfo
		categories: Category[]
	}

	let { slug, store, categories }: Props = $props()

	$effect(() => {
		cart.setSlug(slug)
	})
</script>

{#if store.settings.announcement}
	<div class="bg-gray-900 px-4 py-2 text-center text-xs font-medium text-white">
		{store.settings.announcement}
	</div>
{/if}

<header class="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
	<div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
		<a href={`/${slug}`} class="flex items-center gap-2">
			{#if store.settings.logo}
				<img
					src={store.settings.logo}
					alt={store.settings.name}
					class="h-9 w-9 rounded-full object-cover"
				/>
			{:else}
				<span
					class="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white"
				>
					{store.settings.name.charAt(0)}
				</span>
			{/if}
			<span class="text-lg font-semibold tracking-tight text-gray-900">
				{store.settings.name}
			</span>
		</a>

		<nav class="hidden items-center gap-6 text-sm font-medium text-gray-700 md:flex">
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

		<div class="flex items-center gap-3">
			<form action={`/${slug}/search`} method="get" class="hidden items-center gap-2 sm:flex">
				<input
					type="search"
					name="q"
					placeholder="Search products"
					class="h-9 w-40 rounded-full border border-gray-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 md:w-56"
				/>
				<button
					type="submit"
					class="h-9 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Search
				</button>
			</form>
			<a
				href={`/${slug}/cart`}
				class="relative flex h-9 items-center gap-1 rounded-full border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
		</div>
	</div>
</header>
