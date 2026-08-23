<script lang="ts">
	import { invalidateAll } from '$app/navigation'
	import { browser } from '$app/environment'
	import { ApiError, storefrontApi } from '$lib/api'
	import { cart } from '$lib/cart.svelte'
	import { money } from '$lib/format'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const slug = $derived(data.slug)
	const order = $derived(data.order)

	const pendingPayment = $derived(
		order.status === 'pending' && order.paymentStatus !== 'paid' && order.paymentStatus !== 'failed'
	)

	const addressLines = (addr: typeof order.shippingAddress | null | undefined) => {
		if (!addr) return []
		return [addr.name, addr.line1, addr.line2, [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '), addr.country, addr.phone]
			.filter((v): v is string => !!v)
	}

	// Provider checkout marks the cart as "pending this order" before redirecting.
	// Once confirmed paid, that cart belongs to a placed order — release it.
	let checkingPayment = $state(false)
	$effect(() => {
		if (!browser) return
		const flagKey = `ecom:pending:${slug}`
		const pending = sessionStorage.getItem(flagKey)
		if (pending !== order.orderNumber) return
		sessionStorage.removeItem(flagKey)
		if (order.paymentStatus === 'paid') cart.clear()
	})

	const checkPayment = async () => {
		checkingPayment = true
		try {
			const result = await storefrontApi.syncOrder(fetch, slug, order.orderNumber)
			if (result.paymentStatus === 'paid') {
				await invalidateAll()
			}
		} catch {
			/* keep showing pending state */
		} finally {
			checkingPayment = false
		}
	}
</script>

<svelte:head>
	<title>Order {order.orderNumber} · {store.settings.name}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-12">
	<div class="rounded-2xl border border-gray-200 bg-white p-8 text-center">
		<div
			class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl"
		>
			✓
		</div>
		<h1 class="mt-4 text-3xl font-bold text-gray-900">Thank you</h1>
		<p class="mt-2 text-gray-600">Your order has been placed.</p>
		<p class="mt-4 text-sm text-gray-500">
			Order number
			<span class="ml-1 font-semibold text-gray-900">{order.orderNumber}</span>
		</p>
		<p class="mt-1 text-sm text-gray-500">
			A confirmation email was sent to <span class="font-medium text-gray-900">{order.email}</span>
		</p>

		{#if pendingPayment}
			<div class="mx-auto mt-6 max-w-md rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
				Payment for this order is still being confirmed. If you completed the payment, it will update
				shortly.
				<button
					type="button"
					class="ml-2 font-semibold text-amber-900 underline disabled:opacity-50"
					disabled={checkingPayment}
					onclick={checkPayment}
				>
					{checkingPayment ? 'Checking…' : 'Check now'}
				</button>
			</div>
		{/if}

		<a
			href={`/${slug}`}
			class="mt-8 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
		>
			Continue shopping
		</a>
	</div>

	<div class="mt-8 rounded-2xl border border-gray-200 bg-white p-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-900">Order {order.orderNumber}</h2>
			<span
				class="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold capitalize text-indigo-700"
			>
				{order.status} · {order.paymentStatus}
			</span>
		</div>

		<ul class="mt-6 divide-y divide-gray-200">
			{#each order.items as item (item.id)}
				<li class="flex items-center gap-4 py-4">
					<div class="flex-1">
						<p class="font-medium text-gray-900">{item.name}</p>
						{#if item.sku}
							<p class="text-xs text-gray-400">SKU: {item.sku}</p>
						{/if}
						<p class="text-sm text-gray-500">Qty: {item.quantity}</p>
					</div>
					<p class="font-medium text-gray-900">{money(item.total, order.currency)}</p>
				</li>
			{/each}
		</ul>

		<dl class="mt-4 space-y-2 border-t border-gray-200 pt-4 text-sm">
			<div class="flex justify-between text-gray-600">
				<dt>Subtotal</dt>
				<dd class="font-medium text-gray-900">{money(order.subtotal, order.currency)}</dd>
			</div>
			{#if order.discountTotal > 0}
				<div class="flex justify-between text-gray-600">
					<dt>Discount</dt>
					<dd class="font-medium text-green-700">−{money(order.discountTotal, order.currency)}</dd>
				</div>
			{/if}
			<div class="flex justify-between text-gray-600">
				<dt>Shipping</dt>
				<dd class="font-medium text-gray-900">{money(order.shippingTotal, order.currency)}</dd>
			</div>
			<div class="flex justify-between text-gray-600">
				<dt>Tax</dt>
				<dd class="font-medium text-gray-900">{money(order.taxTotal, order.currency)}</dd>
			</div>
			<div class="flex justify-between border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
				<dt>Total</dt>
				<dd>{money(order.total, order.currency)}</dd>
			</div>
		</dl>

		<div class="mt-6 grid grid-cols-1 gap-6 border-t border-gray-200 pt-6 sm:grid-cols-2">
			<div>
				<h3 class="text-sm font-semibold text-gray-900">Shipping address</h3>
				{#if addressLines(order.shippingAddress).length}
					<p class="mt-2 whitespace-pre-line text-sm text-gray-600">
						{addressLines(order.shippingAddress).join('\n')}
					</p>
				{:else}
					<p class="mt-2 text-sm text-gray-400">Not provided</p>
				{/if}
			</div>
			{#if order.notes}
				<div>
					<h3 class="text-sm font-semibold text-gray-900">Order notes</h3>
					<p class="mt-2 text-sm text-gray-600">{order.notes}</p>
				</div>
			{/if}
		</div>
	</div>
</div>
