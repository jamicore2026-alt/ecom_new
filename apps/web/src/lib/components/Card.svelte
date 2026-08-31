<script lang="ts">
	let { title, subtitle, padded = true, class: className, children, headingLevel = 'h2' } = $props<{
		title?: string
		subtitle?: string
		padded?: boolean
		class?: string
		headingLevel?: 'h2' | 'h3' | 'h4'
		children?: import('svelte').Snippet
	}>()

	const titleTag = headingLevel
</script>

<div class="overflow-hidden rounded border border-outline-variant bg-surface-container-lowest {className ?? ''}">
	{#if title}
		<div class="border-b border-outline-variant px-5 py-4">
			<svelte:element this={titleTag} class="text-[15px] font-semibold tracking-tight text-on-surface">{title}</svelte:element>
			{#if subtitle}
				<p class="mt-0.5 text-xs text-secondary">{subtitle}</p>
			{/if}
		</div>
	{/if}
	<div class={padded ? 'p-5' : ''}>
		{@render children?.()}
	</div>
</div>