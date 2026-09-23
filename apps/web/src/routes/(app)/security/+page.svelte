<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'

	interface MfaStatus {
		enabled: boolean
		backupCodesRemaining: number
	}

	interface LoginSession {
		id: string
		ip: string | null
		userAgent: string | null
		lastSeenAt: string
		expiresAt: string
		revokedAt: string | null
		createdAt: string
		active: boolean
		current: boolean
	}

	let status = $state<MfaStatus | null>(null)
	let sessions = $state<LoginSession[]>([])
	let loading = $state(true)
	let busy = $state(false)

	// Enrollment state
	let setupSecret = $state('')
	let setupUrl = $state('')
	let confirmCode = $state('')
	let freshBackupCodes = $state<string[]>([])
	let disableCode = $state('')
	let regenCode = $state('')
	let showRegen = $state(false)
	let revokingId = $state('')

	async function load() {
		loading = true
		try {
			const [s, list] = await Promise.all([
				api.get<{ success: boolean; data: MfaStatus }>('/api/mfa/status'),
				api.get<{ success: boolean; data: { sessions: LoginSession[] } }>('/api/mfa/sessions')
			])
			status = s.data
			sessions = list.data.sessions
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function shortAgent(ua: string | null) {
		if (!ua) return '—'
		return ua.length > 60 ? `${ua.slice(0, 60)}…` : ua
	}

	function fmtDate(value: string | null) {
		if (!value) return '—'
		try {
			return new Date(value).toLocaleString()
		} catch {
			return value
		}
	}

	async function startSetup() {
		busy = true
		try {
			const res = await api.post<{ success: boolean; data: { secret: string; otpauthUrl: string } }>('/api/mfa/setup')
			setupSecret = res.data.secret
			setupUrl = res.data.otpauthUrl
			confirmCode = ''
			freshBackupCodes = []
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busy = false
		}
	}

	async function confirmSetup() {
		if (!/^\d{6}$/.test(confirmCode.trim())) {
			toast.error('Enter the 6-digit code from your authenticator app')
			return
		}
		busy = true
		try {
			const res = await api.post<{ success: boolean; data: { enabled: boolean; backupCodes: string[] } }>('/api/mfa/enable', { code: confirmCode.trim() })
			freshBackupCodes = res.data.backupCodes
			confirmCode = ''
			await load()
			toast.success('Two-factor authentication enabled')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busy = false
		}
	}

	async function disableMfa() {
		if (!/^\d{6}$/.test(disableCode.trim())) {
			toast.error('Enter the 6-digit code from your authenticator app')
			return
		}
		busy = true
		try {
			await api.post<{ success: boolean }>('/api/mfa/disable', { code: disableCode.trim() })
			disableCode = ''
			setupSecret = ''
			setupUrl = ''
			freshBackupCodes = []
			await load()
			toast.success('Two-factor authentication disabled')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busy = false
		}
	}

	async function regenerateCodes() {
		if (!/^\d{6}$/.test(regenCode.trim())) {
			toast.error('Enter the 6-digit code from your authenticator app')
			return
		}
		busy = true
		try {
			const res = await api.post<{ success: boolean; data: { backupCodes: string[] } }>('/api/mfa/backup-codes/regenerate', { code: regenCode.trim() })
			freshBackupCodes = res.data.backupCodes
			regenCode = ''
			showRegen = false
			await load()
			toast.success('New backup codes generated — old ones no longer work')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busy = false
		}
	}

	async function revokeSession(id: string) {
		revokingId = id
		try {
			const res = await api.delete<{ success: boolean; data: { revoked: boolean; current: boolean } }>(`/api/mfa/sessions/${id}`)
			if (res.data.current) {
				// Revoked our own session — force a fresh login.
				await session.logout()
				window.location.href = '/login'
				return
			}
			toast.success('Session revoked')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			revokingId = ''
		}
	}
</script>

<svelte:head><title>Security — JamiCore</title></svelte:head>

<div class="space-y-5">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<h1 class="font-display text-display text-on-surface">Security</h1>
	</div>

	{#if loading}
		<div class="space-y-2">
			{#each Array(3) as _}
				<div class="h-16 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else}
		<Card title="Two-factor authentication" subtitle="TOTP authenticator app + single-use backup codes">
			{#if !status?.enabled && !setupSecret}
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex items-center gap-2 text-sm text-secondary">
						<Badge label="disabled" />
						<span>Add a second step to sign-in with an authenticator app.</span>
					</div>
					<Button size="sm" loading={busy} onclick={startSetup}>Set up 2FA</Button>
				</div>
			{:else if !status?.enabled && setupSecret}
				<div class="space-y-4">
					<ol class="list-decimal space-y-1 pl-5 text-sm text-secondary">
						<li>Open your authenticator app (Google Authenticator, Authy, 1Password…) and add a new account.</li>
						<li>Enter the setup key below, or paste the otpauth URL.</li>
						<li>Enter the 6-digit code to confirm.</li>
					</ol>
					<div>
						<p class="field-label">Setup key</p>
						<code class="mt-1 block break-all rounded bg-surface-container px-3 py-2 font-mono text-sm text-on-surface">{setupSecret}</code>
					</div>
					<div>
						<p class="field-label">Authenticator URL</p>
						<code class="mt-1 block break-all rounded bg-surface-container px-3 py-2 font-mono text-xs text-secondary">{setupUrl}</code>
					</div>
					<form class="flex max-w-sm items-end gap-2" onsubmit={(e) => { e.preventDefault(); confirmSetup() }}>
						<div class="flex-1">
							<label for="mfa-confirm" class="field-label">6-digit code</label>
							<input id="mfa-confirm" class="field text-center font-mono text-lg tracking-[0.4em]" bind:value={confirmCode} inputmode="numeric" maxlength="6" placeholder="••••••" />
						</div>
						<Button type="submit" loading={busy}>Enable</Button>
					</form>
				</div>
			{:else}
				<div class="space-y-4">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-2 text-sm text-secondary">
							<Badge label="active" />
							<span>{status?.backupCodesRemaining ?? 0} backup codes remaining.</span>
						</div>
						<div class="flex gap-2">
							<Button size="sm" variant="secondary" onclick={() => (showRegen = !showRegen)}>New backup codes</Button>
						</div>
					</div>

					{#if showRegen}
						<form class="flex max-w-sm items-end gap-2" onsubmit={(e) => { e.preventDefault(); regenerateCodes() }}>
							<div class="flex-1">
								<label for="mfa-regen" class="field-label">Confirm with 6-digit code</label>
								<input id="mfa-regen" class="field text-center font-mono text-lg tracking-[0.4em]" bind:value={regenCode} inputmode="numeric" maxlength="6" placeholder="••••••" />
							</div>
							<Button type="submit" size="sm" loading={busy}>Regenerate</Button>
						</form>
					{/if}

					<form class="flex max-w-sm items-end gap-2 border-t border-outline-variant pt-4" onsubmit={(e) => { e.preventDefault(); disableMfa() }}>
						<div class="flex-1">
							<label for="mfa-disable" class="field-label">Disable (confirm with 6-digit code)</label>
							<input id="mfa-disable" class="field text-center font-mono text-lg tracking-[0.4em]" bind:value={disableCode} inputmode="numeric" maxlength="6" placeholder="••••••" />
						</div>
						<Button type="submit" size="sm" variant="danger" loading={busy}>Disable 2FA</Button>
					</form>
				</div>
			{/if}

			{#if freshBackupCodes.length > 0}
				<div class="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
					<p class="flex items-center gap-2 text-sm font-semibold text-on-surface">
						<Icon name="warning" size="text-[18px]" />
						Save these backup codes now — each works once and they won't be shown again.
					</p>
					<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
						{#each freshBackupCodes as code (code)}
							<code class="rounded bg-surface-container-lowest px-2 py-1.5 text-center font-mono text-sm text-on-surface">{code}</code>
						{/each}
					</div>
				</div>
			{/if}
		</Card>

		<Card padded={false}>
			<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
				<h2 class="text-sm font-semibold text-on-surface">Active sessions</h2>
				<Button size="sm" variant="secondary" onclick={load}>Refresh</Button>
			</div>
			{#if sessions.length === 0}
				<div class="flex flex-col items-center gap-2 py-14 text-center">
					<Icon name="devices" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No sessions found.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="px-5 py-3 font-semibold">Device</th>
								<th class="px-3 py-3 font-semibold">IP</th>
								<th class="px-3 py-3 font-semibold">Last seen</th>
								<th class="px-3 py-3 font-semibold">Status</th>
								<th class="px-5 py-3 text-right font-semibold">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each sessions as s (s.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="max-w-64 truncate px-5 py-3 text-xs text-secondary" title={s.userAgent ?? ''}>{shortAgent(s.userAgent)}</td>
									<td class="px-3 py-3 font-mono text-xs text-secondary">{s.ip ?? '—'}</td>
									<td class="px-3 py-3 text-xs text-secondary">{fmtDate(s.lastSeenAt)}</td>
									<td class="px-3 py-3"><Badge label={s.active ? 'active' : 'inactive'} /></td>
									<td class="px-5 py-3 text-right whitespace-nowrap">
										{#if s.active}
											<button class="min-h-11 rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40 disabled:opacity-50" disabled={revokingId === s.id} onclick={() => revokeSession(s.id)}>
												{revokingId === s.id ? 'Revoking…' : 'Revoke'}
											</button>
										{:else}
											<span class="text-xs text-outline">Revoked</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{/if}
</div>
