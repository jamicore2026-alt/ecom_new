<script lang="ts">
	import { goto } from '$app/navigation'
	import { ApiError, storefrontApi } from '$lib/api'
	import { t } from '$lib/i18n'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)

	let orderNumber = $state('')
	let email = $state('')
	let lookupError = $state('')
	let lookingUp = $state(false)

	const submit = async (event: SubmitEvent) => {
		event.preventDefault()
		lookupError = ''
		const num = orderNumber.trim()
		const mail = email.trim().toLowerCase()
		if (!num || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
			lookupError = t('orders.lookupInvalid')
			return
		}
		lookingUp = true
		try {
			// The public order endpoint takes no email param, so verify the
			// contact email client-side and never reveal mismatched orders.
			const order = await storefrontApi.order(fetch, slug, num)
			if ((order.email ?? '').trim().toLowerCase() !== mail) {
				lookupError = t('orders.lookupNotFound')
				return
			}
			await goto(`/${slug}/orders/${encodeURIComponent(order.orderNumber)}`)
		} catch (e) {
			lookupError =
				e instanceof ApiError && e.status === 404
					? t('orders.lookupNotFound')
					: e instanceof ApiError
						? e.message
						: t('orders.lookupNotFound')
		} finally {
			lookingUp = false
		}
	}
</script>

<svelte:head>
	<title>{t('orders.lookupTitle')} · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md px-4 py-10">
	<h1 class="text-3xl font-bold text-neutral-900">{t('orders.lookupTitle')}</h1>
	<p class="mt-2 text-sm text-neutral-500">{t('orders.lookupBody')}</p>

	<form class="mt-6 space-y-4 rounded-2xl border border-neutral-200 bg-white p-6" onsubmit={submit}>
		<div>
			<label class="text-sm font-medium text-neutral-700" for="lookupOrder">{t('orders.lookupOrderNumber')}</label>
			<input
				id="lookupOrder"
				type="text"
				bind:value={orderNumber}
				placeholder={t('account.orderNumberPlaceholder')}
				autocomplete="off"
				class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
			/>
		</div>
		<div>
			<label class="text-sm font-medium text-neutral-700" for="lookupEmail">{t('orders.lookupEmail')}</label>
			<input
				id="lookupEmail"
				type="email"
				bind:value={email}
				placeholder={t('checkout.emailPlaceholder')}
				autocomplete="email"
				class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
			/>
		</div>
		{#if lookupError}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{lookupError}</p>
		{/if}
		<button
			type="submit"
			disabled={lookingUp}
			class="w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
		>
			{lookingUp ? t('common.loading') : t('orders.lookupSubmit')}
		</button>
	</form>
</div>
