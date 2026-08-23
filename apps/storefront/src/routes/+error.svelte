<script lang="ts">
	import { page } from '$app/state'
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
	<p class="text-sm font-semibold uppercase tracking-widest text-indigo-600">Error {page.status}</p>
	<h1 class="mt-2 text-3xl font-bold text-gray-900">
		{page.status === 404 ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="mt-3 max-w-md text-sm text-gray-600">
		{page.error?.message ?? 'An unexpected error occurred.'}
	</p>
	<a
		href="/"
		class="mt-6 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
	>
		Go home
	</a>
</div>
