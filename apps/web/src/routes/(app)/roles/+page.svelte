<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import type { Permission, Role } from '$lib/types'

	const GROUPS: Array<{ label: string; perms: Permission[] }> = [
		{
			label: 'Commerce & Sales',
			perms: ['orders.read', 'orders.create', 'orders.update', 'orders.cancel', 'orders:write', 'products.read', 'products.create', 'products.update', 'products.delete', 'products:write', 'customers.read', 'discounts:write']
		},
		{
			label: 'Inventory',
			perms: ['inventory.read', 'inventory.adjust', 'inventory:write', 'inventory.manage']
		},
		{
			label: 'Restaurant',
			perms: ['menu.read', 'menu.manage', 'kitchen.read', 'kitchen.manage', 'kds.read', 'kds.manage', 'tables.read', 'tables.manage', 'delivery.read', 'delivery.assign', 'delivery.manage', 'drivers.read', 'drivers.manage']
		},
		{
			label: 'Insights & Finance',
			perms: ['analytics:read', 'reports.read', 'payments.read', 'payments.create', 'payments.refund']
		},
		{
			label: 'Administration',
			perms: ['staff.read', 'staff.manage', 'settings.read', 'settings:write', 'settings.manage']
		}
	]

	let roles = $state<Role[]>([])
	let loading = $state(true)
	let selected = $state<Role | null>(null)
	let saving = $state(false)

	let showCreate = $state(false)
	let newName = $state('')

	const canManage = () => session.can('staff.manage')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: Role[] }>('/api/roles')
			roles = res.data
			if (!selected && roles.length) selected = roles[0]
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function has(p: Permission) {
		return !!selected?.permissions.includes(p)
	}

	async function togglePerm(p: Permission) {
		if (!selected) return
		const next = has(p) ? selected.permissions.filter((x) => x !== p) : [...selected.permissions, p]
		selected.permissions = next
		if (!selected.isSystem) saveSelected()
	}

	async function saveSelected() {
		if (!selected) return
		saving = true
		try {
			await api.put(`/api/roles/${selected.id}`, { permissions: selected.permissions })
			toast.success('Permissions saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function createRole() {
		if (!newName.trim()) {
			toast.error('Role name is required')
			return
		}
		saving = true
		try {
			const res = await api.post<{ success: boolean; data: Role }>('/api/roles', { name: newName.trim() })
			toast.success('Role created')
			await load()
			selected = res.data
			showCreate = false
			newName = ''
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function removeRole(r: Role) {
		if (r.isSystem) return
		if (!confirm(`Delete role "${r.name}"?`)) return
		try {
			await api.delete(`/api/roles/${r.id}`)
			toast.success('Role deleted')
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function selectedCount() {
		return selected ? `${selected.permissions.length} granted` : '—'
	}
</script>

<svelte:head>
	<title>Roles &amp; Permissions — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Roles &amp; Permissions</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage access levels for your staff.</p>
		</div>
		{#if canManage()}
			<Button size="sm" onclick={() => { newName = ''; showCreate = true }}><Icon name="add" size="text-[16px]" /> New role</Button>
		{/if}
	</div>

	{#if loading}
		<div class="grid gap-4">
			{#each Array(3) as _}
				<div class="h-24 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-3">
			<Card padded={false} title="Roles" headingLevel="h2">
				<ul class="divide-y divide-outline-variant/60">
					{#each roles as r (r.id)}
						<li>
							<button class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors {selected?.id === r.id ? 'bg-primary-fixed-dim/20' : 'hover:bg-surface-container-low'}" onclick={() => (selected = r)}>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-mono-label text-mono-label text-on-surface">{r.name}</span>
										{#if r.isSystem}<Badge label="System" />{/if}
									</div>
									<p class="mt-0.5 text-xs text-secondary">{r.permissions.length} permissions · {r.scope}</p>
								</div>
								<Icon name="chevron_right" size="text-[18px]" class="text-outline" />
							</button>
						</li>
					{/each}
					{#if roles.length === 0}
						<li class="px-4 py-8 text-center text-sm text-secondary">No roles defined.</li>
					{/if}
				</ul>
			</Card>

			<div class="lg:col-span-2">
				{#if !selected}
					<Card>
						<div class="flex flex-col items-center gap-3 py-16 text-center">
							<Icon name="admin_panel_settings" size="text-[32px]" class="text-outline" />
							<p class="text-sm text-secondary">Select a role to edit its permissions.</p>
						</div>
					</Card>
				{:else}
					<Card>
						<div class="flex items-start justify-between gap-3">
							<div>
								<h2 class="font-display text-2xl text-on-surface">{selected.name}</h2>
								<p class="mt-1 flex items-center gap-2 text-xs text-secondary">{selectedCount()} {selected.isSystem ? '· System role (read-only)' : ''}</p>
							</div>
							{#if canManage() && !selected.isSystem}
								<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => selected && removeRole(selected)} aria-label="Delete role"><Icon name="delete" size="text-[18px]" /></button>
							{/if}
						</div>

						<div class="mt-5 space-y-4">
							{#each GROUPS as g (g.label)}
								<div>
									<h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-on-surface"><Icon name="group_work" size="text-[16px]" class="text-primary" /> {g.label}</h3>
									<div class="grid grid-cols-1 gap-1.5 rounded border border-outline-variant bg-surface-container-lowest p-3 sm:grid-cols-2">
										{#each g.perms as p (g.label + p)}
											<label class="flex items-center gap-2 text-sm text-on-surface-variant {selected.isSystem ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}">
												<input type="checkbox" class="field-check" disabled={selected.isSystem} checked={has(p)} onchange={() => togglePerm(p)} />
												<span class="font-mono-label text-[12px]">{p}</span>
											</label>
										{/each}
									</div>
								</div>
							{/each}
						</div>

						{#if canManage() && !selected.isSystem}
							<div class="mt-4 flex justify-end">
								<Button size="sm" onclick={saveSelected} loading={saving}>Save permissions</Button>
							</div>
						{/if}
					</Card>
				{/if}
			</div>
		</div>
	{/if}
</div>

{#if showCreate}
	<Modal title="New role" open={true} onClose={() => (showCreate = false)}>
		<div class="space-y-4">
			<p class="text-sm text-on-surface-variant">Create a role, then grant it specific permissions.</p>
			<div>
				<label class="field-label" for="role-name">Role name</label>
				<input id="role-name" class="field" bind:value={newName} placeholder="e.g. Inventory Clerk" />
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button size="sm" onclick={createRole} loading={saving}>Create role</Button>
			</div>
		</div>
	</Modal>
{/if}