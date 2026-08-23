<script lang="ts">
	import { cart } from '$lib/cart.svelte'
	import { money, placeholderImage } from '$lib/format'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const slug = $derived(data.slug)

	const lineOptions = (options: Record<string, string>) =>
		Object.entries(options).map(([k, v]) => `${k}: ${v}`).join(' · ')
</script>

<svelte:head>
	<title>Your cart · {store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-10">
	<h1 class="text-3xl font-bold text-gray-900">Your cart</h1>

	{#if cart.items.length === 0}
		<div class="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
			<p class="text-lg font-medium text-gray-700">Your cart is empty</p>
			<p class="text-sm text-gray-500">Browse the store and add something you like.</p>
			<a
				href={`/${slug}/products`}
				class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				Continue shopping
			</a>
		</div>
	{:else}
		<div class="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
			<div class="lg:col-span-2">
				<ul class="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
					{#each cart.items as line (line.variantId)}
						<li class="flex gap-4 p-4">
							<div class="hidden sm:block">
								<img
									src={line.image ?? placeholderImage()}
									alt={line.name}
									class="h-20 w-20 rounded-lg border border-gray-200 object-cover"
								/>
							</div>
							<div class="flex flex-1 flex-col justify-between">
								<div>
									<p class="font-semibold text-gray-900">{line.name}</p>
									{#if lineOptions(line.optionValues)}
										<p class="text-xs text-gray-500">{lineOptions(line.optionValues)}</p>
									{/if}
									<p class="text-sm text-gray-500">
										{line.quantity} × {money(line.price, store.merchant.currency)}
									</p>
								</div>
								<div class="mt-2 flex items-center justify-between">
									<div class="flex items-center rounded-lg border border-gray-300">
										<button
											type="button"
											class="px-3 py-2 text-gray-600 hover:text-gray-900"
											aria-label="Decrease quantity"
											onclick={() => cart.setQuantity(line.variantId, line.quantity - 1)}
										>
											−
										</button>
										<span class="w-10 text-center text-sm font-medium">{line.quantity}</span>
										<button
											type="button"
											class="px-3 py-2 text-gray-600 hover:text-gray-900"
											aria-label="Increase quantity"
											onclick={() => cart.setQuantity(line.variantId, line.quantity + 1)}
										>
											+
										</button>
									</div>
									<button
										type="button"
										class="text-sm font-medium text-red-600 hover:text-red-700"
										onclick={() => cart.remove(line.variantId)}
									>
										Remove
									</button>
								</div>
							</div>
							<p class="font-semibold text-gray-900">
								{money(line.price * line.quantity, store.merchant.currency)}
							</p>
						</li>
					{/each}
				</ul>
			</div>

			<aside class="h-fit rounded-2xl border border-gray-200 bg-white p-6 lg:sticky lg:top-24">
				<h2 class="text-lg font-semibold text-gray-900">Order summary</h2>
				<div class="mt-4 flex justify-between text-sm text-gray-600">
					<span>Subtotal ({cart.count} items)</span>
					<span class="font-medium text-gray-900">{money(cart.subtotal, store.merchant.currency)}</span>
				</div>
				<p class="mt-2 text-xs text-gray-500">Shipping and taxes calculated at checkout.</p>
				<a
					href={`/${slug}/checkout`}
					class="mt-6 block rounded-lg bg-indigo-600 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
				>
					Checkout
				</a>
				<a
					href={`/${slug}/products`}
					class="mt-3 block text-center text-sm font-medium text-gray-600 hover:text-gray-900"
				>
					Continue shopping
				</a>
			</aside>
		</div>
	{/if}
</div>
