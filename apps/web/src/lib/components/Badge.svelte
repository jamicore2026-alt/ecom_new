<script lang="ts">
	import { titleCase } from '$lib/format'

	let { label } = $props<{ label: string }>()

	const toneMap: Record<string, string> = {
		pending: 'bg-warning/10 text-warning',
		processing: 'bg-info/10 text-info',
		shipped: 'bg-primary/10 text-primary',
		delivered: 'bg-success/10 text-success',
		cancelled: 'bg-error/10 text-error',
		refunded: 'bg-secondary/10 text-secondary',
		unpaid: 'bg-warning/10 text-warning',
		paid: 'bg-success/10 text-success',
		partially_refunded: 'bg-warning/10 text-warning',
		failed: 'bg-error/10 text-error',
		unfulfilled: 'bg-secondary/10 text-secondary',
		fulfilled: 'bg-success/10 text-success',
		approved: 'bg-success/10 text-success',
		rejected: 'bg-error/10 text-error',
		restocked: 'bg-primary/10 text-primary',
		completed: 'bg-success/10 text-success',
		active: 'bg-success/10 text-success',
		maintenance: 'bg-warning/10 text-warning',
		inactive: 'bg-secondary/10 text-secondary',
		draft: 'bg-secondary/10 text-secondary',
		archived: 'bg-secondary/10 text-secondary',
		disabled: 'bg-secondary/10 text-secondary',
		invited: 'bg-info/10 text-info',
		owner: 'bg-primary/10 text-primary',
		admin: 'bg-info/10 text-info',
		staff: 'bg-secondary/10 text-secondary',
		percentage: 'bg-primary/10 text-primary',
		fixed: 'bg-info/10 text-info',
		free_shipping: 'bg-success/10 text-success',
		active_outlet: 'bg-success/10 text-success'
	}
</script>

<span
	class="inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium {toneMap[label] ?? 'bg-secondary/10 text-secondary'}"
>
	{titleCase(label.split('_').join(' '))}
</span>