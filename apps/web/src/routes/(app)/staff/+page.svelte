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
	import type { Permission, StaffMember } from '$lib/types'

	const PERMISSIONS: Permission[] = [
		'products:write', 'orders:write', 'inventory:write', 'discounts:write',
		'settings:write', 'analytics:read', 'customers.read', 'reports.read'
	]

	let staff = $state<StaffMember[]>([])
	let loading = $state(true)
	let saving = $state(false)

	interface StaffInvite {
		id: string
		email: string
		status: string
		expiresAt: string
		createdAt: string
	}
	let invites = $state<StaffInvite[]>([])

	let showInvite = $state(false)
	let showEmailInvite = $state(false)
	let editing = $state<StaffMember | null>(null)
	let sName = $state('')
	let sEmail = $state('')
	let sPassword = $state('')
	let sRole = $state<'admin' | 'staff'>('staff')
	let sPerms = $state<Permission[]>([])
	let inviteEmail = $state('')
	let inviteRole = $state<'admin' | 'staff'>('staff')
	let invitePerms = $state<Permission[]>([])

	const isAdmin = () => session.isAdmin

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: StaffMember[] }>('/api/settings/staff')
			staff = res.data
			try {
				const inv = await api.get<{ success: boolean; data: StaffInvite[] }>('/api/settings/staff/invites')
				invites = inv.data.filter((i) => i.status === 'pending')
			} catch {
				invites = []
			}
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function openInvite() {
		editing = null
		sName = ''
		sEmail = ''
		sPassword = ''
		sRole = 'staff'
		sPerms = []
		showInvite = true
	}

	function openEdit(m: StaffMember) {
		editing = m
		sName = m.name
		sEmail = m.email
		sPassword = ''
		sRole = m.role === 'admin' ? 'admin' : 'staff'
		sPerms = [...m.permissions]
		showInvite = true
	}

	async function save() {
		if (!sName.trim() || !sEmail.trim() || (!editing && !isStrong(sPassword))) {
			toast.error(editing ? 'Name and email are required' : 'Name, email and a strong 12+ char password (upper, lower, digit) are required')
			return
		}
		saving = true
		try {
			if (editing) {
				const body: Record<string, unknown> = { name: sName.trim(), email: sEmail.trim(), role: sRole, permissions: sPerms }
				if (sPassword) body.password = sPassword
				await api.put(`/api/settings/staff/${editing.id}`, body)
				toast.success('Staff updated')
			} else {
				await api.post('/api/settings/staff', { name: sName.trim(), email: sEmail.trim(), password: sPassword, role: sRole, permissions: sPerms })
				toast.success('Staff invited')
			}
			showInvite = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	function isStrong(pw: string) {
		return pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
	}

	function openEmailInvite() {
		inviteEmail = ''
		inviteRole = 'staff'
		invitePerms = []
		showEmailInvite = true
	}

	async function sendEmailInvite() {
		if (!inviteEmail.trim()) {
			toast.error('Email is required')
			return
		}
		saving = true
		try {
			await api.post('/api/settings/staff/invite', { email: inviteEmail.trim(), role: inviteRole, permissions: invitePerms })
			toast.success('Invitation sent')
			showEmailInvite = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function resendInvite(id: string) {
		try {
			await api.post(`/api/settings/staff/invites/${id}/resend`)
			toast.success('Invitation resent')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function revokeInvite(id: string) {
		try {
			await api.post(`/api/settings/staff/invites/${id}/revoke`)
			toast.success('Invitation revoked')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function toggleStatus(m: StaffMember) {
		if (m.role === 'owner') return
		try {
			await api.put(`/api/settings/staff/${m.id}`, { status: m.status === 'active' ? 'disabled' : 'active' })
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function initials(name: string) {
		return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
	}
</script>

<svelte:head>
	<title>Staff Directory — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Staff Directory</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage personnel, roles, and system access.</p>
		</div>
		{#if isAdmin()}
			<div class="flex gap-2">
				<Button size="sm" variant="secondary" onclick={openEmailInvite}><Icon name="mail" size="text-[16px]" /> Email invite</Button>
				<Button size="sm" onclick={openInvite}><Icon name="person_add" size="text-[16px]" /> Invite staff</Button>
			</div>
		{/if}
	</div>

	{#if !loading && invites.length > 0}
		<Card title="Pending invitations" headingLevel="h2" padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Email</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Expires</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each invites as inv (inv.id)}
							<tr class="border-b border-outline-variant/60">
								<td class="px-table-cell-x py-table-cell-y text-on-surface">{inv.email}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(inv.expiresAt)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if isAdmin()}
										<div class="flex items-center justify-end gap-1">
											<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => resendInvite(inv.id)} aria-label="Resend invitation"><Icon name="refresh" size="text-[18px]" /></button>
											<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => revokeInvite(inv.id)} aria-label="Revoke invitation"><Icon name="cancel" size="text-[18px]" /></button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}

	{#if loading}
		<div class="grid gap-4">
			{#each Array(4) as _}
				<div class="h-16 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if staff.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<Icon name="group_off" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No staff members yet.</p>
			</div>
		</Card>
	{:else}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Staff</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Role</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Permissions</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each staff as m (m.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low {m.status === 'disabled' ? 'opacity-60' : ''}">
								<td class="px-table-cell-x py-table-cell-y">
									<div class="flex items-center gap-3">
										<span class="flex h-9 w-9 items-center justify-center rounded bg-primary-container text-xs font-semibold text-on-primary-container">{initials(m.name)}</span>
										<div>
											<p class="font-medium text-on-surface">{m.name}</p>
											<p class="text-xs text-secondary">{m.email}</p>
										</div>
									</div>
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={m.role} /></td>
								<td class="px-table-cell-x py-table-cell-y">
									<span class="line-clamp-1 text-xs text-secondary">{m.permissions.length ? m.permissions.join(', ') : '—'}</span>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(m.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={m.status} /></td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if isAdmin()}
										<div class="flex items-center justify-end gap-1">
											<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openEdit(m)} aria-label="Edit staff"><Icon name="edit" size="text-[18px]" /></button>
											{#if m.role !== 'owner'}
												<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => toggleStatus(m)} aria-label="Toggle status"><Icon name={m.status === 'active' ? 'block' : 'check_circle'} size="text-[18px]" /></button>
											{/if}
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
</div>

{#if showInvite}
	<Modal title={editing ? `Edit ${editing.name}` : 'Invite staff'} open={true} onClose={() => (showInvite = false)}>
		<div class="space-y-4">
			<div>
				<label class="field-label" for="st-name">Name</label>
				<input id="st-name" class="field" bind:value={sName} placeholder="Full name" />
			</div>
			<div>
				<label class="field-label" for="st-email">Email</label>
				<input id="st-email" class="field" bind:value={sEmail} type="email" placeholder="name@example.com" />
			</div>
			{#if !editing}
				<div>
					<label class="field-label" for="st-password">Password</label>
					<input id="st-password" class="field" bind:value={sPassword} type="password" minlength={12} placeholder="Min 12 chars, upper + lower + digit" />
				</div>
			{/if}
			<div>
				<label class="field-label" for="st-role">Role</label>
				<select id="st-role" class="field" bind:value={sRole}>
					<option value="staff">Staff</option>
					<option value="admin">Admin</option>
				</select>
			</div>
			<div>
				<p class="field-label">Permission grants</p>
				<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
					{#each PERMISSIONS as p (p)}
						<label class="flex items-center gap-2 text-sm text-on-surface-variant">
							<input type="checkbox" class="field-check" checked={sPerms.includes(p)} onchange={(e) => {
								const el = e.currentTarget as HTMLInputElement
								sPerms = el.checked ? [...sPerms, p] : sPerms.filter((x) => x !== p)
							}} />
							<span>{p}</span>
						</label>
					{/each}
				</div>
			</div>
			<div class="flex justify-end gap-2 border-t border-outline-variant/60 pt-4">
				<Button variant="secondary" size="sm" onclick={() => (showInvite = false)}>Cancel</Button>
				<Button size="sm" onclick={save} loading={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Invite'}</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if showEmailInvite}
	<Modal title="Invite by email" open={true} onClose={() => (showEmailInvite = false)}>
		<div class="space-y-4">
			<div>
				<label class="field-label" for="inv-email">Email</label>
				<input id="inv-email" class="field" bind:value={inviteEmail} type="email" placeholder="name@example.com" />
				<p class="mt-1 text-xs text-secondary">They'll receive a link to set their name and password (12+ chars, upper + lower + digit).</p>
			</div>
			<div>
				<label class="field-label" for="inv-role">Role</label>
				<select id="inv-role" class="field" bind:value={inviteRole}>
					<option value="staff">Staff</option>
					<option value="admin">Admin</option>
				</select>
			</div>
			<div>
				<p class="field-label">Permission grants</p>
				<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
					{#each PERMISSIONS as p (p)}
						<label class="flex items-center gap-2 text-sm text-on-surface-variant">
							<input type="checkbox" class="field-check" checked={invitePerms.includes(p)} onchange={(e) => {
								const el = e.currentTarget as HTMLInputElement
								invitePerms = el.checked ? [...invitePerms, p] : invitePerms.filter((x) => x !== p)
							}} />
							<span>{p}</span>
						</label>
					{/each}
				</div>
			</div>
			<div class="flex justify-end gap-2 border-t border-outline-variant/60 pt-4">
				<Button variant="secondary" size="sm" onclick={() => (showEmailInvite = false)}>Cancel</Button>
				<Button size="sm" onclick={sendEmailInvite} loading={saving}>{saving ? 'Sending…' : 'Send invite'}</Button>
			</div>
		</div>
	</Modal>
{/if}