<script lang="ts">
	import { account } from '$lib/account.svelte'
	import { t } from '$lib/i18n'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)
	const token = $derived(data.token)

	$effect(() => {
		account.setSlug(slug)
	})

	let password = $state('')
	let error = $state('')
	let success = $state(false)
	let submitting = $state(false)

	async function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ''
		if (password.length < 8) {
			error = t('account.passwordMinLength')
			return
		}
		submitting = true
		try {
			await account.resetPassword(fetch, token, password)
			success = true
		} catch {
			error = t('account.reset.invalid')
		} finally {
			submitting = false
		}
	}
</script>

<svelte:head>
	<title>{t('account.reset.title')} · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md px-4 py-14">
	<div class="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
		{#if success}
			<div class="text-center">
				<h1 class="text-xl font-bold text-gray-900">{t('account.reset.success')}</h1>
				<a
					href={`/${slug}/account`}
					class="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					{t('account.reset.signIn')}
				</a>
			</div>
		{:else}
			<h1 class="text-xl font-bold text-gray-900">{t('account.reset.title')}</h1>

			<form class="mt-6 space-y-4" onsubmit={submit}>
				<div>
					<label class="text-sm font-medium text-gray-700" for="resetPassword">{t('account.reset.newPassword')}</label>
					<input
						id="resetPassword"
						type="password"
						bind:value={password}
						placeholder={t('account.reset.passwordMinLengthHint')}
						autocomplete="new-password"
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
					{submitting ? t('common.loading') : t('account.reset.submit')}
				</button>
			</form>
		{/if}
	</div>
</div>