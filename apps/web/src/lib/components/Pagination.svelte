<script lang="ts">
	import type { PaginationMeta } from '$lib/types'

	export let meta: PaginationMeta
	export let onPage: (page: number) => void = () => {}

	$: pages = Array.from({ length: meta.totalPages }, (_, i) => i + 1)
</script>

{#if meta.totalPages > 1}
	<nav class="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
		<p class="text-xs text-gray-500">
			Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
		</p>
		<div class="flex items-center gap-1">
			<button
				class="min-h-11 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
				disabled={meta.page <= 1}
				onclick={() => onPage(meta.page - 1)}
			>
				‹ Prev
			</button>
			<span class="px-2 text-sm text-gray-700">
				{meta.page} / {meta.totalPages}
			</span>
			<button
				class="min-h-11 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
				disabled={meta.page >= meta.totalPages}
				onclick={() => onPage(meta.page + 1)}
			>
				Next ›
			</button>
		</div>
	</nav>
{/if}
