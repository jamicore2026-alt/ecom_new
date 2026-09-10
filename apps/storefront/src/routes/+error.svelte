<script lang="ts">
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 text-center">
	<p class="text-sm font-semibold uppercase tracking-widest text-brand-600">{t('error.label')} {page.status}</p>
	<h1 class="mt-2 text-3xl font-bold text-neutral-900">
		{page.status === 404 ? t('error.notFound') : t('error.somethingWrong')}
	</h1>
	<p class="mt-3 max-w-md text-sm text-neutral-600">
		{page.error?.message ?? t('error.unexpected')}
	</p>
	<a
		href="/"
		class="mt-6 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
	>
		{t('error.goHome')}
	</a>
</div>
