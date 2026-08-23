<script lang="ts">
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)
	const orderNumber = $derived(data.orderNumber)

	const retryHref = $derived(
		`?order=${encodeURIComponent(orderNumber)}&r=${Date.now()}`
	)
	const checkoutHref = $derived(`/${slug}/checkout`)
</script>

<svelte:head>
	<title>Payment status · {orderNumber}</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-16">
	<div class="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center">
		{#if data.errorMessage}
			<h1 class="text-2xl font-bold text-gray-900">We hit a snag</h1>
			<p class="mt-3 text-sm text-gray-600">{data.errorMessage}</p>
			<a
				href={`/${slug}/orders/${encodeURIComponent(orderNumber)}`}
				class="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				View your order
			</a>
		{:else if data.paymentStatus === 'pending' || data.paymentStatus === 'unknown'}
			<h1 class="text-2xl font-bold text-gray-900">Payment processing</h1>
			<p class="mt-3 text-sm text-gray-600">
				Your payment for <span class="font-semibold">{orderNumber}</span> is still being confirmed.
				This usually takes only a moment.
			</p>
			<div class="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
				<a
					href={retryHref}
					class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Check again
				</a>
				<a
					href={checkoutHref}
					class="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
				>
					Back to checkout
				</a>
			</div>
		{:else}
			<h1 class="text-2xl font-bold text-red-700">Payment not completed</h1>
			<p class="mt-3 text-sm text-gray-600">
				The payment for <span class="font-semibold">{orderNumber}</span> did not go through.
				Your items are still in the cart if you would like to try again.
			</p>
			<a
				href={checkoutHref}
				class="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				Try again
			</a>
		{/if}
	</div>
</div>
