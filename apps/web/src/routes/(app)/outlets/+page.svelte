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
	import { dateTime } from '$lib/format'
	import type { Address, Outlet, StaffMember } from '$lib/types'

	let outlets = $state<Outlet[]>([])
	let loading = $state(true)
	let saving = $state(false)

	let showForm = $state(false)
	let editing = $state<Outlet | null>(null)
	let form = $state({
		name: '',
		code: '',
		status: 'active',
		line1: '',
		line2: '',
		city: '',
		state: '',
		postalCode: '',
		country: '',
		phone: ''
	})

	let staff = $state<StaffMember[]>([])
	let staffLoading = $state(false)
	let assignments = $state<Record<string, string[]>>({})
	let selectedOutlets = $state<Record<string, string[]>>({})
	let savingAssignments = $state<Record<string, boolean>>({})

	const canManage = () => session.can('staff.manage')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: Outlet[] }>('/api/outlets')
			outlets = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function loadStaff() {
		if (!canManage() || staffLoading) return
		staffLoading = true
		try {
			const res = await api.get<{ success: boolean; data: StaffMember[] }>('/api/settings/staff')
			staff = res.data
			for (const u of staff) {
				try {
					const r = await api.get<{ success: boolean; data: Outlet[] }>(`/api/user-outlets/${u.id}`)
					const ids = r.data.map((o) => o.id)
					assignments[u.id] = ids
					selectedOutlets[u.id] = [...ids]
				} catch (e) {
					toast.error((e as Error).message)
					assignments[u.id] = []
					selectedOutlets[u.id] = []
				}
			}
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			staffLoading = false
		}
	}

	onMount(() => {
		load()
		loadStaff()
	})

	function resetForm() {
		editing = null
		form = { name: '', code: '', status: 'active', line1: '', line2: '', city: '', state: '', postalCode: '', country: '', phone: '' }
		showForm = true
	}

	function openEdit(o: Outlet) {
		editing = o
		form = {
			name: o.name,
			code: o.code,
			status: o.status,
			line1: o.address?.line1 ?? '',
			line2: o.address?.line2 ?? '',
			city: o.address?.city ?? '',
			state: o.address?.state ?? '',
			postalCode: o.address?.postalCode ?? '',
			country: o.address?.country ?? '',
			phone: o.address?.phone ?? ''
		}
		showForm = true
	}

	function buildAddress(): Address {
		const a: Address = {}
		if (form.line1.trim()) a.line1 = form.line1.trim()
		if (form.line2.trim()) a.line2 = form.line2.trim()
		if (form.city.trim()) a.city = form.city.trim()
		if (form.state.trim()) a.state = form.state.trim()
		if (form.postalCode.trim()) a.postalCode = form.postalCode.trim()
		if (form.country.trim()) a.country = form.country.trim()
		if (form.phone.trim()) a.phone = form.phone.trim()
		return a
	}

	async function save() {
		if (!form.name.trim()) {
			toast.error('Name is required')
			return
		}
		if (!form.code.trim()) {
			toast.error('Code is required')
			return
		}
		saving = true
		try {
			const address = buildAddress()
			const body = { name: form.name.trim(), code: form.code.trim(), status: form.status, address }
			if (editing) {
				await api.put(`/api/outlets/${editing.id}`, body)
				toast.success('Outlet updated')
			} else {
				await api.post('/api/outlets', body)
				toast.success('Outlet created')
			}
			showForm = false
			await load()
			await loadStaff()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function archiveOutlet(o: Outlet) {
		if (o.status === 'archived') return
		if (!confirm(`Archive outlet "${o.name}"?`)) return
		try {
			await api.delete(`/api/outlets/${o.id}`)
			toast.success('Outlet archived')
			await load()
			await loadStaff()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function addressLine(o: Outlet): string {
		const line = [o.address?.city, o.address?.state, o.address?.country].filter(Boolean).join(', ')
		if (line) return line
		return o.address?.line1 ?? '—'
	}

	function initials(name: string) {
		return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
	}

	function isDirty(userId: string): boolean {
		const a = [...(assignments[userId] ?? [])].sort().join('|')
		const s = [...(selectedOutlets[userId] ?? [])].sort().join('|')
		return a !== s
	}

	async function saveAssignments(userId: string) {
		if (savingAssignments[userId]) return
		savingAssignments[userId] = true
		try {
			const res = await api.put<{ success: boolean; data: { userId: string; outlets: string[] } }>(
				`/api/user-outlets/${userId}`,
				{ outletIds: selectedOutlets[userId] ?? [] }
			)
			assignments[userId] = res.data.outlets
			selectedOutlets[userId] = [...res.data.outlets]
			toast.success('Assignments updated')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			savingAssignments[userId] = false
		}
	}
</script>

<svelte:head>
	<title>Outlets — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Outlets</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage store locations and team access.</p>
		</div>
		{#if canManage()}
			<Button size="sm" onclick={resetForm}><Icon name="add" size="text-[16px]" /> New outlet</Button>
		{/if}
	</div>

	{#if loading}
		<div class="space-y-2 p-5">
			{#each Array(6) as _}
				<div class="h-12 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if outlets.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<Icon name="storefront" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No outlets yet.</p>
			</div>
		</Card>
	{:else}
		<Card padded={false} title={`Outlets (${outlets.length})`}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Outlet</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Code</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Address</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
							{#if canManage()}
								<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each outlets as o (o.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low {o.status === 'archived' ? 'opacity-60' : ''}">
								<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{o.name}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono text-xs text-secondary">{o.code}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{addressLine(o)}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={o.status} /></td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(o.createdAt)}</td>
								{#if canManage()}
									<td class="px-table-cell-x py-table-cell-y">
										<div class="flex items-center justify-end gap-1">
											<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openEdit(o)} aria-label={`Edit ${o.name}`}><Icon name="edit" size="text-[18px]" /></button>
											<button
												class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
												onclick={() => archiveOutlet(o)}
												disabled={o.status === 'archived'}
												aria-label={`Archive ${o.name}`}
											><Icon name="archive" size="text-[18px]" /></button>
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}

	{#if canManage()}
		<Card title="Assign users to outlets" subtitle="Choose which outlets each team member can operate.">
			{#if staffLoading}
				<div class="space-y-2">
					{#each Array(3) as _}
						<div class="h-14 animate-pulse rounded bg-surface-container"></div>
					{/each}
				</div>
			{:else if staff.length === 0}
				<p class="py-6 text-center text-sm text-secondary">No staff members to assign.</p>
			{:else}
				<ul class="divide-y divide-outline-variant/60">
					{#each staff as u (u.id)}
						<li class="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
							<div class="flex shrink-0 items-center gap-3">
								<span class="flex h-9 w-9 items-center justify-center rounded bg-primary-container text-xs font-semibold text-on-primary-container">{initials(u.name)}</span>
								<div>
									<p class="font-medium text-on-surface">{u.name}</p>
									<p class="text-xs text-secondary">{u.email} · <Badge label={u.role} /></p>
								</div>
							</div>
							<div class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 md:justify-end">
								{#if outlets.length === 0}
									<span class="text-sm text-secondary">No outlets available</span>
								{:else}
									{#each outlets as o (o.id)}
										<label class="flex cursor-pointer items-center gap-1.5 text-sm text-on-surface-variant">
											<input
												type="checkbox"
												class="field-check"
												checked={selectedOutlets[u.id]?.includes(o.id) ?? false}
												onchange={(e) => {
													const el = e.currentTarget as HTMLInputElement
													const prev = selectedOutlets[u.id] ?? []
													selectedOutlets[u.id] = el.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)
												}}
											/>
											<span>{o.name}</span>
										</label>
									{/each}
								{/if}
								<Button
									variant="secondary"
									size="sm"
									disabled={!isDirty(u.id)}
									loading={savingAssignments[u.id]}
									onclick={() => saveAssignments(u.id)}
								>Save</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}
</div>

{#if showForm}
	<Modal title={editing ? `Edit ${editing.name}` : 'New outlet'} open={true} onClose={() => (showForm = false)}>
		<div class="space-y-4">
			<div>
				<label class="field-label" for="outlet-name">Name</label>
				<input id="outlet-name" class="field" bind:value={form.name} placeholder="e.g. Downtown Store" />
			</div>
			<div>
				<label class="field-label" for="outlet-code">Code</label>
				<input id="outlet-code" class="field font-mono" bind:value={form.code} placeholder="e.g. DT-01" />
			</div>
			<div>
				<label class="field-label" for="outlet-status">Status</label>
				<select id="outlet-status" class="field" bind:value={form.status}>
					<option value="active">Active</option>
					<option value="inactive">Inactive</option>
					<option value="archived">Archived</option>
				</select>
			</div>
			<div>
				<p class="field-label">Address</p>
				<div class="space-y-3">
					<input class="field" bind:value={form.line1} placeholder="Address line 1" aria-label="Address line 1" />
					<input class="field" bind:value={form.line2} placeholder="Address line 2" aria-label="Address line 2" />
					<div class="grid gap-3 sm:grid-cols-2">
						<input class="field" bind:value={form.city} placeholder="City" aria-label="City" />
						<input class="field" bind:value={form.state} placeholder="State / Region" aria-label="State / Region" />
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<input class="field" bind:value={form.postalCode} placeholder="Postal code" aria-label="Postal code" />
						<input class="field" bind:value={form.country} placeholder="Country" aria-label="Country" />
					</div>
					<input class="field" bind:value={form.phone} placeholder="Phone" aria-label="Phone" />
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onclick={() => (showForm = false)}>Cancel</Button>
				<Button size="sm" onclick={save} loading={saving}>{editing ? 'Save changes' : 'Create outlet'}</Button>
			</div>
		</div>
	</Modal>
{/if}