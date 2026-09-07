<script lang="ts">
	import { page } from '$app/state'
	import { session } from '$lib/session.svelte'
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-4 text-center">
	<p class="text-sm font-semibold uppercase tracking-widest text-primary">Error {page.status}</p>
	<h1 class="mt-2 text-3xl font-bold text-on-surface">
		{page.status === 404 ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="mt-3 max-w-md text-sm text-on-surface-variant">
		{page.error?.message ?? 'An unexpected error occurred.'}
	</p>
	<a
		href={session.isAuthenticated ? '/dashboard' : '/login'}
		class="mt-6 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-on-primary transition hover:bg-on-primary-fixed-variant"
	>
		Go back
	</a>
</div>
