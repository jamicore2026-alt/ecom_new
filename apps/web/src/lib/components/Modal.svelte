<script lang="ts">
	let { open = false, title, width = 'md', onClose, children } = $props<{
		open?: boolean
		title?: string
		width?: 'sm' | 'md' | 'lg' | 'xl'
		onClose?: () => void
		children?: import('svelte').Snippet
	}>()

	const widthClass: Record<string, string> = {
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-2xl',
		xl: 'max-w-4xl'
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 pt-10"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose?.()
		}}
	>
		<div
			class="w-full {widthClass[width]} rounded border border-outline-variant bg-surface-container-lowest shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label={title ?? 'Dialog'}
			tabindex="-1"
		>
			<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
				<h3 class="text-[15px] font-semibold text-on-surface">{title ?? 'Dialog'}</h3>
				<button
					class="flex h-9 w-9 items-center justify-center rounded text-secondary hover:bg-surface-container hover:text-on-surface"
					onclick={() => onClose?.()}
					aria-label="Close"
					type="button"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="px-5 py-4">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
