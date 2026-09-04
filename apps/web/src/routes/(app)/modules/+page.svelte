<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import type { ModuleId } from '$lib/types'

	interface ModuleEntry {
		module: string
		enabled: boolean
		locked: boolean
	}

	const MODULE_META: Record<ModuleId, { label: string; description: string }> = {
		commerce: { label: 'Commerce', description: 'Product catalog, orders, and storefront.' },
		restaurant: { label: 'Restaurant', description: 'Restaurant operations and food ordering.' },
		pos: { label: 'Point of Sale', description: 'In-store POS terminal and checkout.' },
		kitchen: { label: 'Kitchen', description: 'Kitchen display system and order routing.' },
		tables: { label: 'Tables (Dine-in)', description: 'Dine-in table management and QR menus.' },
		delivery: { label: 'Delivery', description: 'Delivery zones, drivers, and tracking.' },
		inventory: { label: 'Inventory', description: 'Stock tracking, adjustments, and warehouses.' },
		marketing: { label: 'Marketing', description: 'Campaigns, segments, and customer engagement.' },
		analytics: { label: 'Analytics', description: 'Sales, product, and customer insights.' }
	}

	let modules = $state<ModuleEntry[]>([])
	let loading = $state(true)
	let saving = $state<string | null>(null)

	const canManage = () => session.can('settings.manage')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: ModuleEntry[] }>('/api/modules')
			modules = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function toggle(entry: ModuleEntry) {
		if (saving) return
		const nextEnabled = !entry.enabled
		saving = entry.module
		try {
			const res = await api.put<{ success: boolean; data: ModuleEntry }>(
				`/api/modules/${entry.module}`,
				{ enabled: nextEnabled }
			)
			modules = modules.map((m) =>
				m.module === entry.module ? { ...m, enabled: res.data.enabled, locked: false } : m
			)
			toast.success(`${MODULE_META[entry.module as ModuleId]?.label ?? entry.module} ${nextEnabled ? 'enabled' : 'disabled'}`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = null
		}
	}
</script>

<svelte:head>
	<title>Modules &mdash; Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8">
		<h1 class="font-display text-display text-on-surface">Modules</h1>
		<p class="mt-1 text-body-sm text-secondary">
			Control which features appear in the sidebar for this store. Toggle a module on to activate it, or off to hide it.
		</p>
	</div>

	{#if loading}
		<div class="grid gap-4">
			{#each Array(4) as _}
				<div class="h-24 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each modules as entry (entry.module)}
				{@const meta = MODULE_META[entry.module as ModuleId]}
				<Card>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<h3 class="text-[15px] font-semibold tracking-tight text-on-surface">
									{meta?.label ?? entry.module}
								</h3>
								{#if entry.locked}
									<Badge label="locked" />
								{/if}
							</div>
							<p class="mt-1 text-xs text-secondary">
								{meta?.description ?? ''}
							</p>
						</div>
						<label class="flex items-center {canManage() ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}">
							<input
								type="checkbox"
								class="field-check"
								checked={entry.enabled}
								disabled={!canManage() || saving === entry.module}
								onchange={() => toggle(entry)}
							/>
						</label>
					</div>
				</Card>
			{/each}
			{#if modules.length === 0}
				<div class="col-span-full flex flex-col items-center gap-2 py-16 text-center">
					<Icon name="widgets" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No modules found.</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
