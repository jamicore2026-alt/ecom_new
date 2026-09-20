<script lang="ts">
	import { toast } from '$lib/toast.svelte'
</script>

<div class="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
	{#each toast.items as t (t.id)}
		<div
			role="status"
			class="pointer-events-auto rounded border border-outline-variant px-4 py-3 text-sm font-medium shadow-md"
			class:bg-success={t.type === 'success'}
			class:bg-error={t.type === 'error'}
			class:bg-info={t.type === 'info'}
			class:text-on-success={t.type === 'success'}
			class:text-on-error={t.type === 'error'}
			class:text-on-surface={t.type === 'info'}
		>
			{t.message}
		</div>
	{/each}
</div>
