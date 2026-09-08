<script lang="ts">
	let {
		open = false,
		title,
		width = 'md',
		description,
		onClose,
		children
	} = $props<{
		open?: boolean
		title?: string
		width?: 'sm' | 'md' | 'lg' | 'xl'
		description?: string
		onClose?: () => void
		children?: import('svelte').Snippet
	}>()

	let dialog = $state<HTMLElement | null>(null)
	const descriptionId = title ? `modal-desc-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'modal-desc'

	const widthClass: Record<string, string> = {
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-2xl',
		xl: 'max-w-4xl'
	}

	function focusable(): HTMLElement[] {
		if (!dialog) return []
		return [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
	}

	function onDialogKeydown(e: KeyboardEvent) {
		if (!open) return
		if (e.key === 'Escape') {
			e.preventDefault()
			onClose?.()
		} else if (e.key === 'Tab') {
			const els = focusable()
			if (els.length === 0) return
			const first = els[0]
			const last = els[els.length - 1]
			if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
				e.preventDefault()
				last.focus()
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault()
				first.focus()
			} else if (!e.shiftKey && document.activeElement === dialog) {
				e.preventDefault()
				first.focus()
			}
		}
	}

	$effect(() => {
		if (open) {
			const trigger = document.activeElement as HTMLElement | null
			requestAnimationFrame(() => dialog?.focus())
			return () => {
				trigger?.focus?.()
			}
		}
	})
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
			bind:this={dialog}
			class="w-full {widthClass[width]} rounded border border-outline-variant bg-surface-container-lowest shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label={title ?? 'Dialog'}
			aria-describedby={description ? descriptionId : undefined}
			tabindex="-1"
			onkeydown={onDialogKeydown}
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
			{#if description}
				<p id={descriptionId} class="px-5 pt-3 text-sm text-secondary">{description}</p>
			{/if}
			<div class="px-5 py-4">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}