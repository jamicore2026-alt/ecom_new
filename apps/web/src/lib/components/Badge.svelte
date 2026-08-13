<script lang="ts">
	import { titleCase } from '$lib/format'

	let { label } = $props<{ label: string }>()

	const toneMap: Record<string, string> = {
		pending: 'bg-amber-100 text-amber-800 ring-amber-200',
		processing: 'bg-blue-100 text-blue-800 ring-blue-200',
		shipped: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
		delivered: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		cancelled: 'bg-red-100 text-red-800 ring-red-200',
		refunded: 'bg-gray-200 text-gray-700 ring-gray-300',
		unpaid: 'bg-orange-100 text-orange-800 ring-orange-200',
		paid: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		partially_refunded: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
		failed: 'bg-red-100 text-red-800 ring-red-200',
		unfulfilled: 'bg-slate-100 text-slate-700 ring-slate-200',
		fulfilled: 'bg-teal-100 text-teal-800 ring-teal-200',
		approved: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		rejected: 'bg-red-100 text-red-800 ring-red-200',
		restocked: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
		completed: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		active: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		draft: 'bg-slate-100 text-slate-700 ring-slate-200',
		archived: 'bg-gray-200 text-gray-600 ring-gray-300',
		disabled: 'bg-gray-200 text-gray-600 ring-gray-300',
		invited: 'bg-sky-100 text-sky-800 ring-sky-200',
		owner: 'bg-violet-100 text-violet-800 ring-violet-200',
		admin: 'bg-blue-100 text-blue-800 ring-blue-200',
		staff: 'bg-slate-100 text-slate-700 ring-slate-200',
		percentage: 'bg-violet-100 text-violet-800 ring-violet-200',
		fixed: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
		free_shipping: 'bg-teal-100 text-teal-800 ring-teal-200'
	}
</script>

<span
	class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {toneMap[label] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}"
>
	{titleCase(label)}
</span>
