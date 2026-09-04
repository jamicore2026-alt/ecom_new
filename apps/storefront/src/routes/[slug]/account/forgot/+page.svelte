<script lang="ts">
	import { account } from '$lib/account.svelte'
	import { t } from '$lib/i18n'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)

	$effect(() => {
		account.setSlug(slug)
	})

	let email = $state('')
	let error = $state('')
	let sent = $state(false)
	let submitting = $state(false)

	async function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ''
		if (!email.trim()) {
			error = t('account.forgot.emailRequired')
			return
		}
		submitting = true
		try {
			await account.requestPasswordReset(fetch, email.trim())
			sent = true
		} catch {
			error = t('account.genericError')
		} finally {
			submitting = false
		}
	}
</script>

<svelte:head>
	<title>{t('account.forgot.title')} · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md px-4 py-14">
	<div class="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
		{#if sent}
			<div class="text-center">
				<h1 class="text-xl font-bold text-gray-900">{t('account.forgot.sentTitle')}</h1>
				<p class="mt-3 text-sm text-gray-500">{t('account.forgot.sentBody')}</p>
				<a
					href={`/${slug}/account`}
					class="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
				>
					{t('account.forgot.backToLogin')}
				</a>
			</div>
		{:else}
			<h1 class="text-xl font-bold text-gray-900">{t('account.forgot.title')}</h1>
			<p class="mt-2 text-sm text-gray-500">{t('account.forgot.subtitle')}</p>

			<form class="mt-6 space-y-4" onsubmit={submit}>
				<div>
					<label class="text-sm font-medium text-gray-700" for="forgotEmail">{t('account.forgot.email')}</label>
					<input
						id="forgotEmail"
						type="email"
						bind:value={email}
						autocomplete="email"
						required
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>

				{#if error}
					<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
				>
					{submitting ? t('account.forgot.loading') : t('account.forgot.submit')}
				</button>
				<a href={`/${slug}/account`} class="block text-center text-sm font-medium text-indigo-600 hover:text-indigo-700">
					{t('account.forgot.backToLogin')}
				</a>
			</form>
		{/if}
	</div>
</div>