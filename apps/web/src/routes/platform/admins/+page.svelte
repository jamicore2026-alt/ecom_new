<script lang="ts">
	import { onMount } from 'svelte'
	import { platformApi } from '$lib/platform-api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Button from '$lib/components/Button.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { dateTimeFull } from '$lib/format'

	interface Admin {
		id: string
		email: string
		status: string
		lastLoginAt: string | null
		mfaEnabled: boolean
		createdAt: string
	}

	let admins = $state<Admin[]>([])
	let loading = $state(true)
	let createOpen = $state(false)
	let fEmail = $state('')
	let fPassword = $state('')
	let creating = $state(false)
	let busyId = $state('')
	let pwOpen = $state(false)
	let oldPassword = $state('')
	let newPassword = $state('')
	let pwSaving = $state(false)

	let myId = $state('')
	let mfaEnabled = $state(false)
	let mfaBackupLeft = $state(0)
	let mfaSetup = $state<{ otpauthUrl: string; secret: string } | null>(null)
	let mfaCode = $state('')
	let mfaPw = $state('')
	let mfaBusy = $state(false)
	let freshBackupCodes = $state<string[]>([])

	async function loadMe() {
		try {
			const me = await platformApi.me()
			myId = me.id
			mfaEnabled = me.mfaEnabled
			const st = await platformApi.mfaStatus()
			mfaBackupLeft = st.backupCodesRemaining
		} catch {
			// non-fatal: MFA card stays hidden
		}
	}

	async function startMfaSetup() {
		mfaBusy = true
		try {
			mfaSetup = await platformApi.mfaSetup()
			freshBackupCodes = []
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			mfaBusy = false
		}
	}

	async function confirmMfaEnable() {
		mfaBusy = true
		try {
			const res = await platformApi.mfaEnable(mfaCode)
			freshBackupCodes = res.backupCodes
			mfaSetup = null
			mfaCode = ''
			mfaEnabled = true
			toast.success('MFA enabled — save your backup codes')
			await load()
			await loadMe()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			mfaBusy = false
		}
	}

	async function disableMfa() {
		if (!mfaPw || !confirm('Disable two-factor authentication?')) return
		mfaBusy = true
		try {
			await platformApi.mfaDisable(mfaPw)
			mfaPw = ''
			mfaEnabled = false
			toast.success('MFA disabled')
			await loadMe()
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			mfaBusy = false
		}
	}

	async function load() {
		loading = true
		try {
			admins = await platformApi.listAdmins()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(() => {
		load()
		loadMe()
	})

	async function submitCreate() {
		if (!fEmail.trim() || fPassword.length < 12) {
			toast.error('Email required; password min 12 chars (upper, lower + digit)')
			return
		}
		creating = true
		try {
			await platformApi.createAdmin(fEmail.trim(), fPassword)
			toast.success('Admin created')
			fEmail = ''
			fPassword = ''
			createOpen = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			creating = false
		}
	}

	async function setStatus(a: Admin, status: 'active' | 'disabled') {
		if (!confirm(`${status === 'disabled' ? 'Disable' : 'Enable'} ${a.email}?${status === 'disabled' ? ' Their sessions stop working immediately.' : ''}`)) return
		busyId = a.id
		try {
			await platformApi.setAdminStatus(a.id, status)
			toast.success(`${a.email} ${status}`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busyId = ''
		}
	}

	async function revoke(a: Admin) {
		if (!confirm(`Revoke all sessions of ${a.email}? They must sign in again.`)) return
		busyId = a.id
		try {
			await platformApi.revokeAdminSessions(a.id)
			toast.success('Sessions revoked')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busyId = ''
		}
	}

	async function submitPassword() {
		if (newPassword.length < 12) {
			toast.error('New password min 12 chars (upper, lower + digit)')
			return
		}
		pwSaving = true
		try {
			await platformApi.changeOwnPassword(oldPassword, newPassword)
			toast.success('Password changed — other sessions revoked')
			oldPassword = ''
			newPassword = ''
			pwOpen = false
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			pwSaving = false
		}
	}
</script>

<svelte:head>
	<title>Admins — JamiCore Admin</title>
</svelte:head>

<a href="/platform/merchants" class="mb-4 inline-flex items-center gap-1 text-sm font-medium text-secondary hover:text-on-surface">
	<Icon name="arrow_back" size="text-[16px]" />
	All merchants
</a>

<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
	<div>
		<h1 class="text-3xl font-bold tracking-tight text-on-surface">Platform admins</h1>
		<p class="mt-1 text-sm text-secondary">{admins.length} admin(s) · disabling or password change revokes sessions immediately</p>
	</div>
	<div class="flex gap-2">
		<Button size="sm" variant="secondary" onclick={() => (pwOpen = true)}>Change my password</Button>
		<Button size="sm" onclick={() => (createOpen = true)}><Icon name="add" size="text-[16px]" /> New admin</Button>
	</div>
</div>

<Card padded={false}>
	{#if loading}
		<div class="space-y-2 p-5">
			{#each Array(3) as _}
				<div class="h-14 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if admins.length === 0}
		<div class="py-16 text-center text-sm text-secondary">No admins found.</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
					<tr>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Email</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">MFA</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Last login</th>
						<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-outline-variant/60">
					{#each admins as a (a.id)}
						<tr class="transition-colors hover:bg-surface-container-low">
							<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{a.email}</td>
							<td class="px-table-cell-x py-table-cell-y"><Badge label={a.status} /></td>
							<td class="px-table-cell-x py-table-cell-y"><Badge label={a.mfaEnabled ? 'on' : 'off'} /></td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{a.lastLoginAt ? dateTimeFull(a.lastLoginAt) : '—'}</td>
							<td class="px-table-cell-x py-table-cell-y text-right">
								<div class="flex justify-end gap-1">
									{#if a.status === 'active'}
										<button class="rounded px-2 py-1 text-xs font-medium text-error hover:bg-error-container/40" disabled={busyId === a.id} onclick={() => setStatus(a, 'disabled')}>Disable</button>
									{:else}
										<button class="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" disabled={busyId === a.id} onclick={() => setStatus(a, 'active')}>Enable</button>
									{/if}
									<button class="rounded px-2 py-1 text-xs font-medium text-secondary hover:bg-surface-container" disabled={busyId === a.id} onclick={() => revoke(a)}>Revoke sessions</button>
								</div>
							</td>
						</tr>
					{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	<Card title="My two-factor authentication" subtitle="Opt-in TOTP for your own account">
		{#if mfaEnabled}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-secondary">Enabled · {mfaBackupLeft} backup code(s) left</p>
				<div class="flex items-center gap-2">
					<input type="password" class="field w-48" placeholder="Current password" bind:value={mfaPw} autocomplete="current-password" />
					<Button size="sm" variant="secondary" loading={mfaBusy} onclick={disableMfa}>Disable MFA</Button>
				</div>
			</div>
		{:else if mfaSetup}
			<div class="space-y-3">
				<p class="text-sm text-secondary">Scan this key in your authenticator app, then enter a code to enable.</p>
				<p class="rounded bg-surface-container p-3 font-mono text-xs break-all text-on-surface">{mfaSetup.secret}</p>
				<p class="text-xs text-secondary break-all">{mfaSetup.otpauthUrl}</p>
				<div class="flex items-center gap-2">
					<input inputmode="numeric" maxlength="6" class="field w-40" placeholder="123456" bind:value={mfaCode} />
					<Button size="sm" loading={mfaBusy} onclick={confirmMfaEnable}>Verify & enable</Button>
				</div>
				{#if freshBackupCodes.length}
					<div class="rounded border border-outline-variant p-3">
						<p class="mb-2 text-sm font-medium text-on-surface">Backup codes — save them now, shown once:</p>
						<ul class="grid gap-1 font-mono text-sm text-on-surface sm:grid-cols-2">
							{#each freshBackupCodes as c (c)}<li>{c}</li>{/each}
						</ul>
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-secondary">Not enabled. Adds a second step to your sign-in.</p>
				<Button size="sm" variant="secondary" loading={mfaBusy} onclick={startMfaSetup}>Set up MFA</Button>
			</div>
		{/if}
	</Card>

{#if createOpen}
	<Modal title="New platform admin" open={true} width="sm" onClose={() => (createOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); submitCreate() }}>
			<div>
				<label for="na-email" class="field-label">Email *</label>
				<input id="na-email" type="email" class="field" bind:value={fEmail} required />
			</div>
			<div>
				<label for="na-password" class="field-label">Password (min 12: upper, lower + digit) *</label>
				<input id="na-password" type="password" class="field" bind:value={fPassword} required minlength={12} autocomplete="new-password" />
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" loading={creating}>Create admin</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if pwOpen}
	<Modal title="Change my password" open={true} width="sm" onClose={() => (pwOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); submitPassword() }}>
			<div>
				<label for="pw-old" class="field-label">Current password *</label>
				<input id="pw-old" type="password" class="field" bind:value={oldPassword} required autocomplete="current-password" />
			</div>
			<div>
				<label for="pw-new" class="field-label">New password (min 12: upper, lower + digit) *</label>
				<input id="pw-new" type="password" class="field" bind:value={newPassword} required minlength={12} autocomplete="new-password" />
			</div>
			<p class="text-xs text-secondary">Changing your password revokes your other sessions immediately.</p>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" onclick={() => (pwOpen = false)}>Cancel</Button>
				<Button type="submit" loading={pwSaving}>Change password</Button>
			</div>
		</form>
	</Modal>
{/if}
