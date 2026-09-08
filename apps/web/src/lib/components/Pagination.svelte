<script lang="ts">
	import type { PaginationMeta } from '$lib/types'

	let {
		meta,
		onPage = () => {}
	} = $props<{
		meta: PaginationMeta
		onPage?: (page: number) => void
	}>()

	// Windowed page list: "1 … 4 5 6 … 12" keeps the control compact on mobile.
	const WINDOW = 2
	function pageItems(): (number | '…')[] {
		const total = meta.totalPages
		const cur = meta.page
		if (total <= WINDOW * 2 + 3) return Array.from({ length: total }, (_, i) => i + 1)
		const items: (number | '…')[] = [1]
		const start = Math.max(2, cur - WINDOW)
		const end = Math.min(total - 1, cur + WINDOW)
		if (start > 2) items.push('…')
		for (let i = start; i <= end; i++) items.push(i)
		if (end < total - 1) items.push('…')
		items.push(total)
		return items
	}

	let pages = $derived(pageItems())
</script>

{#if meta.totalPages > 1}
	<nav class="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant px-4 py-3">
		<p class="text-xs text-secondary">
			Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
		</p>
		<div class="flex flex-wrap items-center gap-1">
			<button
				class="min-h-11 rounded px-3 text-sm text-secondary hover:bg-surface-container disabled:opacity-40"
				disabled={meta.page <= 1}
				onclick={() => onPage(meta.page - 1)}
			>
				‹ Prev
			</button>
			{#each pages as n}
				{#if n === '…'}
					<span class="min-h-11 px-1 text-sm text-secondary">…</span>
				{:else}
					<button
						class="min-h-11 min-w-11 rounded px-2 text-sm {n === meta.page
							? 'bg-primary text-on-primary'
							: 'text-secondary hover:bg-surface-container'}"
						onclick={() => onPage(n)}
					>
						{n}
					</button>
				{/if}
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