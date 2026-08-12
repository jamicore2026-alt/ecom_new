<script lang="ts">
	import { toast } from '$lib/toast.svelte'
</script>

<div class="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
	{#each toast.items as t (t.id)}
		<div
			class="pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
			class:bg-emerald-600={t.type === 'success'}
			class:bg-red-600={t.type === 'error'}
			class:text-white={true}
		>
			{t.message}
		</div>
	{/each}
</div>
