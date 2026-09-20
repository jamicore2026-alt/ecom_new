<script lang="ts">
	let {
		open = false,
		title = 'Are you sure?',
		message = '',
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		tone = 'danger',
		onConfirm,
		onCancel
	} = $props<{
		open?: boolean
		title?: string
		message?: string
		confirmLabel?: string
		cancelLabel?: string
		tone?: 'danger' | 'primary'
		onConfirm?: () => void
		onCancel?: () => void
	}>()

	import Modal from './Modal.svelte'
	import Button from './Button.svelte'
</script>

<Modal {open} {title} width="sm" onClose={onCancel}>
	{#if message}
		<p class="text-sm text-on-surface-variant">{message}</p>
	{/if}
	<div class="mt-5 flex justify-end gap-2">
		<Button variant="secondary" size="sm" onclick={onCancel}>{cancelLabel}</Button>
		<Button variant={tone === 'danger' ? 'danger' : 'primary'} size="sm" onclick={onConfirm}>
			{confirmLabel}
		</Button>
	</div>
</Modal>
