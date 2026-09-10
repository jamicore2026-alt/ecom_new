<script lang="ts">
	import type { PageProps } from './$types'
	import { t } from '$lib/i18n'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)
	const orderNumber = $derived(data.orderNumber)

	const retryHref = $derived(
		`?order=${encodeURIComponent(orderNumber)}&r=${Date.now()}`
	)
	const checkoutHref = $derived(`/${slug}/checkout`)
</script>

<svelte:head>
	<title>{t('checkoutReturn.title')} · {orderNumber}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-16">
	<div class="rounded-2xl border border-neutral-200 bg-white px-6 py-12 text-center">
		{#if data.errorMessage}
			<h1 class="text-2xl font-bold text-neutral-900">{t('checkoutReturn.errorHeading')}</h1>
			<p class="mt-3 text-sm text-neutral-600">{data.errorMessage}</p>
			<a
				href={`/${slug}/orders/${encodeURIComponent(orderNumber)}`}
				class="mt-6 inline-block rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
			>
				{t('checkoutReturn.viewOrder')}
			</a>
		{:else if data.paymentStatus === 'pending' || data.paymentStatus === 'unknown'}
			<h1 class="text-2xl font-bold text-neutral-900">{t('checkoutReturn.processingHeading')}</h1>
			<p class="mt-3 text-sm text-neutral-600">
				{@html t('checkoutReturn.processingBody').replace('{order}', `<span class="font-semibold">${orderNumber}</span>`)}
			</p>
			<div class="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
				<a
					href={retryHref}
					class="rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
				>
					{t('checkoutReturn.checkAgain')}
				</a>
				<a
					href={checkoutHref}
					class="rounded-lg border border-neutral-300 px-6 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
				>
					{t('checkoutReturn.backToCheckout')}
				</a>
			</div>
		{:else}
			<h1 class="text-2xl font-bold text-red-700">{t('checkoutReturn.failedHeading')}</h1>
			<p class="mt-3 text-sm text-neutral-600">
				{@html t('checkoutReturn.failedBody').replace('{order}', `<span class="font-semibold">${orderNumber}</span>`)}
			</p>
			<a
				href={checkoutHref}
				class="mt-6 inline-block rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
			>
				{t('checkoutReturn.tryAgain')}
			</a>
		{/if}
	</div>
</div>
