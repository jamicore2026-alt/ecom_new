<script lang="ts">
	let { title, subtitle, padded = true, class: className, children } = $props<{
		title?: string
		subtitle?: string
		padded?: boolean
		class?: string
		children?: import('svelte').Snippet
	}>()
</script>

<div class="rounded-xl border border-gray-200 bg-white shadow-sm {className ?? ''}">
	{#if title}
		<div class="border-b border-gray-100 px-5 py-4">
			<h3 class="text-base font-semibold text-gray-900">{title}</h3>
			{#if subtitle}
				<p class="mt-0.5 text-xs text-gray-500">{subtitle}</p>
			{/if}
		</div>
	{/if}
	<div class={padded ? 'p-5' : ''}>
		{@render children?.()}
	</div>
</div>
