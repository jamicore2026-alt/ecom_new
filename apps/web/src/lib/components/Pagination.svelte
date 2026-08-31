<script lang="ts">
	import type { PaginationMeta } from '$lib/types'

	export let meta: PaginationMeta
	export let onPage: (page: number) => void = () => {}

	$: pages = Array.from({ length: meta.totalPages }, (_, i) => i + 1)
</script>

{#if meta.totalPages > 1}
	<nav class="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant px-4 py-3">
		<p class="text-xs text-secondary">
			Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
		</p>
		<div class="flex items-center gap-1">
			<button
				class="min-h-11 rounded px-3 text-sm text-secondary hover:bg-surface-container disabled:opacity-40"
				disabled={meta.page <= 1}
				onclick={() => onPage(meta.page - 1)}
			>
				‹ Prev
			</button>
			{#each pages as n}
				<button
					class="min-h-11 min-w-9 rounded px-2 text-sm {n === meta.page
						? 'bg-primary text-on-primary'
						: 'text-secondary hover:bg-surface-container'}"
					onclick={() => onPage(n)}
				>
					{n}
				</button>
			{/each}
			<button
				class="min-h-11 rounded px-3 text-sm text-secondary hover:bg-surface-container disabled:opacity-40"
				disabled={meta.page >= meta.totalPages}
				onclick={() => onPage(meta.page + 1)}
			>
				Next ›
			</button>
		</div>
	</nav>
{/if}