<script lang="ts">
	import { account } from '$lib/account.svelte'
	import { t } from '$lib/i18n'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)
	const token = $derived(data.token)

	let state = $state<'pending' | 'verified' | 'already' | 'error'>('pending')

	$effect(() => {
		account.setSlug(slug)
		void (async () => {
			try {
				const res = await account.verifyEmail(fetch, token)
				state = res.verified ? 'verified' : 'already'
			} catch {
				state = 'error'
			}
		})()
	})
</script>

<svelte:head>
	<title>{t('accountVerify.title')} · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md px-4 py-14">
	<div class="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
		{#if state === 'pending'}
			<p class="py-6 text-center text-sm text-gray-400">{t('common.loading')}</p>
		{:else if state === 'verified'}
			<div class="text-center">
				<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">✓</div>
				<h1 class="mt-4 text-xl font-bold text-gray-900">{t('accountVerify.success')}</h1>
				<a href={`/${slug}/account`} class="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
					{t('accountVerify.account')}
				</a>
			</div>
		{:else if state === 'already'}
			<div class="text-center">
				<h1 class="mt-4 text-xl font-bold text-gray-900">{t('accountVerify.alreadyVerified')}</h1>
				<a href={`/${slug}/account`} class="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
					{t('accountVerify.account')}
				</a>
			</div>
		{:else}
			<div class="text-center">
				<h1 class="mt-4 text-xl font-bold text-gray-900">{t('accountVerify.error')}</h1>
				<a href={`/${slug}/account`} class="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
					{t('accountVerify.signIn')}
				</a>
			</div>
		{/if}
	</div>
</div>