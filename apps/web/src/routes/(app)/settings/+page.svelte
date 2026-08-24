<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { titleCase } from '$lib/format'
	import type { Address, NotificationSettings, PaymentProviderView, PaymentSettings, Permission, ShippingSettings, StaffMember, StoreSettings, TaxSettings } from '$lib/types'

	type Section = 'store' | 'payments' | 'shipping' | 'taxes' | 'notifications' | 'staff'
	let section = $state<Section>('store')
	let saving = $state(false)

	// store
	let store = $state<StoreSettings | null>(null)
	let sName = $state('')
	let sCurrency = $state('')
	let sTimezone = $state('')
	let sAnnouncement = $state('')
	let addr = $state<Address>({})

	// payments
	let payments = $state<PaymentSettings | null>(null)
	let pCurrency = $state('')
	let methods = $state<Array<{ id: string; label: string; enabled: boolean }>>([])
	let providers = $state<PaymentProviderView[]>([])
	let providerCreds = $state<Record<string, Record<string, string>>>({})
	let savingProviderId = $state('')
	let testingProviderId = $state('')

	// shipping
	let shipping = $state<ShippingSettings | null>(null)
	let freeShippingThreshold = $state('0')
	let zones = $state<Array<{ name: string; countriesText: string; rate: string }>>([])

	// taxes
	let taxes = $state<TaxSettings | null>(null)
	let autoCalculate = $state(true)
	let rates = $state<Array<{ region: string; rate: string }>>([])

	// notifications
	let notifications = $state<NotificationSettings | null>(null)
	let nEnabled = $state(true)
	let nFromName = $state('')
	let nFromEmail = $state('')
	const EMAIL_TEMPLATES: Array<{ id: string; label: string }> = [
		{ id: 'order_placed', label: 'Order placed' },
		{ id: 'order_paid', label: 'Payment received' },
		{ id: 'refund_processed', label: 'Refund processed' }
	]

	// staff
	let staff = $state<StaffMember[]>([])
	let staffOpen = $state(false)
	let editingStaff = $state<StaffMember | null>(null)
	let staffName = $state('')
	let staffEmail = $state('')
	let staffPassword = $state('')
	let staffRole = $state<'admin' | 'staff'>('staff')
	let staffPerms = $state<Permission[]>([])

	const PERMISSIONS: Permission[] = [
		'products:write',
		'orders:write',
		'inventory:write',
		'discounts:write',
		'settings:write',
		'analytics:read'
	]

	const isAdmin = () => session.isAdmin

	async function load() {
		try {
			if (section === 'store') {
				const res = await api.get<{ success: boolean; data: StoreSettings }>('/api/settings/store')
				store = res.data
				sName = res.data.name
				sCurrency = res.data.currency
				sTimezone = res.data.timezone
				sAnnouncement = res.data.announcement
				addr = { ...res.data.address }
		} else if (section === 'payments') {
			const [payRes, providerRes] = await Promise.all([
				api.get<{ success: boolean; data: PaymentSettings }>('/api/settings/payments'),
				api.get<{ success: boolean; data: PaymentProviderView[] }>('/api/settings/payments/providers')
			])
			payments = payRes.data
			pCurrency = payRes.data.currency
			methods = payRes.data.methods.map((m) => ({ ...m }))
			providers = providerRes.data
			const creds: Record<string, Record<string, string>> = {}
			for (const p of providers) {
				creds[p.id] = {}
				for (const f of p.credentialFields) creds[p.id][f.key] = ''
			}
			providerCreds = creds
		} else if (section === 'shipping') {
				const res = await api.get<{ success: boolean; data: ShippingSettings }>('/api/settings/shipping')
				shipping = res.data
				freeShippingThreshold = String(res.data.freeShippingThreshold)
				zones = res.data.zones.map((z) => ({ name: z.name, countriesText: z.countries.join(', '), rate: String(z.rate) }))
			} else if (section === 'taxes') {
				const res = await api.get<{ success: boolean; data: TaxSettings }>('/api/settings/taxes')
				taxes = res.data
				autoCalculate = res.data.autoCalculate
				rates = res.data.rates.map((r) => ({ region: r.region, rate: String(r.rate) }))
			} else if (section === 'notifications') {
				const res = await api.get<{ success: boolean; data: NotificationSettings }>('/api/settings/notifications')
				notifications = res.data
				nEnabled = res.data.enabled
				nFromName = res.data.fromName ?? ''
				nFromEmail = res.data.fromEmail ?? ''
			} else {
				const res = await api.get<{ success: boolean; data: StaffMember[] }>('/api/settings/staff')
				staff = res.data
			}
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)

	function switchSection(s: Section) {
		section = s
		load()
	}

	async function saveStore() {
		saving = true
		try {
			const res = await api.put<{ success: boolean; data: StoreSettings }>('/api/settings/store', {
				name: sName,
				currency: sCurrency,
				timezone: sTimezone,
				announcement: sAnnouncement,
				address: addr
			})
			store = res.data
			toast.success('Store settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function savePayments() {
		saving = true
		try {
			await api.put<{ success: boolean }>('/api/settings/payments', {
				methods,
				currency: pCurrency
			})
			toast.success('Payment settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	function providerPayload(p: PaymentProviderView, extra: Record<string, unknown> = {}) {
		const credentials: Record<string, string> = {}
		for (const f of p.credentialFields) {
			const v = providerCreds[p.id]?.[f.key]?.trim()
			if (v) credentials[f.key] = v
		}
		return {
			enabled: p.enabled,
			mode: p.mode,
			country: p.country ?? undefined,
			...(Object.keys(credentials).length ? { credentials } : {}),
			...extra
		}
	}

	async function saveProvider(p: PaymentProviderView) {
		savingProviderId = p.id
		try {
			const res = await api.put<{ success: boolean; data: { providerId: string; enabled: boolean } }>(
				`/api/settings/payments/providers/${p.id}`,
				providerPayload(p)
			)
			const idx = providers.findIndex((x) => x.id === p.id)
			if (idx >= 0) providers[idx] = { ...providers[idx], ...res.data ? { enabled: res.data.enabled } : {} }
			const fresh = await api.get<{ success: boolean; data: PaymentProviderView[] }>('/api/settings/payments/providers')
			providers = fresh.data
			for (const np of providers) for (const f of np.credentialFields) (providerCreds[np.id] ??= {})[f.key] = ''
			toast.success(`${p.label} saved`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			savingProviderId = ''
		}
	}

	async function toggleProvider(p: PaymentProviderView) {
		p.enabled = !p.enabled
		await saveProvider(p)
	}

	async function testProvider(p: PaymentProviderView) {
		testingProviderId = p.id
		try {
			await api.post<{ success: boolean }>(`/api/settings/payments/providers/${p.id}/test`, {})
			toast.success(`${p.label} connection OK`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			testingProviderId = ''
		}
	}

	async function saveShipping() {
		saving = true
		try {
			await api.put<{ success: boolean }>('/api/settings/shipping', {
			zones: zones.map((z) => ({
				name: z.name,
				countries: z.countriesText.split(',').map((c) => c.trim()).filter(Boolean),
				rate: Number(z.rate)
			})),
				freeShippingThreshold: Number(freeShippingThreshold)
			})
			toast.success('Shipping settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function saveTaxes() {
		saving = true
		try {
			await api.put<{ success: boolean }>('/api/settings/taxes', {
				autoCalculate,
				rates: rates.map((r) => ({ region: r.region, rate: Number(r.rate) }))
			})
			toast.success('Tax settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function saveNotifications() {
		saving = true
		try {
			const res = await api.put<{ success: boolean; data: NotificationSettings }>(
				'/api/settings/notifications',
				{
					enabled: nEnabled,
					fromName: nFromName || null,
					fromEmail: nFromEmail || null
				}
			)
			notifications = res.data
			toast.success('Notification settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	function toggleTemplate(id: string, value: boolean) {
		if (!notifications) return
		notifications.templates = { ...notifications.templates, [id]: value }
		api.put<{ success: boolean }>('/api/settings/notifications', { templates: notifications.templates }).catch(
			(e: unknown) => toast.error((e as Error).message)
		)
	}

	function openNewStaff() {
		editingStaff = null
		staffName = ''
		staffEmail = ''
		staffPassword = ''
		staffRole = 'staff'
		staffPerms = ['products:write']
		staffOpen = true
	}

	function openEditStaff(m: StaffMember) {
		editingStaff = m
		staffName = m.name
		staffEmail = m.email
		staffPassword = ''
		staffRole = m.role === 'owner' ? 'admin' : (m.role as 'admin' | 'staff')
		staffPerms = [...m.permissions]
		staffOpen = true
	}

	async function saveStaff() {
		saving = true
		try {
			if (editingStaff) {
				await api.put<{ success: boolean }>(`/api/settings/staff/${editingStaff.id}`, {
					name: staffName,
					...(staffEmail !== editingStaff.email ? { email: staffEmail } : {}),
					...(staffPassword ? { password: staffPassword } : {}),
					role: staffRole,
					permissions: staffPerms
				})
				toast.success('Staff updated')
			} else {
				await api.post<{ success: boolean }>('/api/settings/staff', {
					name: staffName,
					email: staffEmail,
					password: staffPassword,
					role: staffRole,
					permissions: staffPerms
				})
				toast.success('Staff created')
			}
			staffOpen = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function toggleStaff(m: StaffMember) {
		if (!confirm(`${m.status === 'active' ? 'Disable' : 'Enable'} ${m.name}?`)) return
		try {
			await api.put<{ success: boolean }>(`/api/settings/staff/${m.id}`, { status: m.status === 'active' ? 'disabled' : 'active' })
			toast.success('Staff updated')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function togglePerm(p: Permission) {
		staffPerms = staffPerms.includes(p) ? staffPerms.filter((x) => x !== p) : [...staffPerms, p]
	}

	const sections: Array<{ id: Section; label: string }> = [
		{ id: 'store', label: 'Store' },
		{ id: 'payments', label: 'Payments' },
		{ id: 'shipping', label: 'Shipping' },
		{ id: 'taxes', label: 'Taxes' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'staff', label: 'Staff' }
	]
</script>

{#if !isAdmin()}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
		Settings require an <span class="font-semibold">admin</span> or <span class="font-semibold">owner</span> role.
	</div>
{:else}
	<div class="space-y-5">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Settings</h1>
		</div>

		<div class="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 w-fit">
			{#each sections as s (s.id)}
				<button class="rounded-md px-3 py-1.5 text-sm font-medium" class:bg-indigo-600={section === s.id} class:text-white={section === s.id} class:text-gray-600={section !== s.id} onclick={() => switchSection(s.id)}>
					{s.label}
				</button>
			{/each}
		</div>

		{#if section === 'store' && store}
			<Card title="Store settings">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveStore() }}>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm font-medium text-gray-700">Store name</label>
							<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={sName} required />
						</div>
						<div>
							<label class="mb-1 block text-sm font-medium text-gray-700">Currency</label>
							<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase" bind:value={sCurrency} maxlength="10" />
						</div>
						<div>
							<label class="mb-1 block text-sm font-medium text-gray-700">Timezone</label>
							<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={sTimezone} placeholder="UTC" />
						</div>
						<div>
							<label class="mb-1 block text-sm font-medium text-gray-700">Announcement</label>
							<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={sAnnouncement} />
						</div>
					</div>

					<div>
						<p class="mb-2 text-sm font-medium text-gray-700">Address</p>
						<div class="grid gap-3 sm:grid-cols-2">
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Name" bind:value={addr.name} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Line 1" bind:value={addr.line1} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Line 2" bind:value={addr.line2} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="City" bind:value={addr.city} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="State" bind:value={addr.state} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Postal code" bind:value={addr.postalCode} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Country" bind:value={addr.country} />
							<input class="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Phone" bind:value={addr.phone} />
						</div>
					</div>

					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'payments' && payments}
			{#each providers as p (p.id)}
				<Card>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<h3 class="text-sm font-semibold text-gray-900">{p.label}</h3>
								<Badge label={p.mode} />
								<span class="text-[11px] font-medium {p.configured ? 'text-green-600' : 'text-gray-400'}">
									{p.configured ? '● credentials saved' : '○ not configured'}
								</span>
							</div>
							<p class="mt-1 max-w-xl text-xs text-gray-500">{p.description}</p>
							{#if p.currencies.length}
								<p class="mt-1 text-[11px] text-gray-400">Currencies: {p.currencies.join(', ')}</p>
							{/if}
						</div>
						<label class="flex shrink-0 cursor-pointer items-center gap-2">
							<input type="checkbox" class="h-4 w-4 rounded border-gray-300" checked={p.enabled} onchange={() => toggleProvider(p)} />
							<span class="text-xs font-medium text-gray-600">{p.enabled ? 'Enabled' : 'Disabled'}</span>
						</label>
					</div>

					<div class="mt-4 grid gap-3 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-xs font-medium text-gray-700" for={`${p.id}-mode`}>Mode</label>
							<select
								id={`${p.id}-mode`}
								class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
								bind:value={p.mode}
							>
								<option value="test">Test / Sandbox</option>
								<option value="live">Live</option>
							</select>
						</div>
						{#if p.countries}
							<div>
								<label class="mb-1 block text-xs font-medium text-gray-700" for={`${p.id}-country`}>Account country</label>
								<select
									id={`${p.id}-country`}
									class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
									bind:value={p.country}
								>
									{#each p.countries as c (c)}
										<option value={c}>{c}</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>

					<div class="mt-3 grid gap-3 sm:grid-cols-2">
						{#each p.credentialFields as f (f.key)}
							<div>
								<label class="mb-1 block text-xs font-medium text-gray-700" for={`${p.id}-${f.key}`}>
									{f.label}{f.required ? ' *' : ''}
								</label>
								<input
									id={`${p.id}-${f.key}`}
									type={f.secret ? 'password' : 'text'}
									class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
									bind:value={providerCreds[p.id][f.key]}
									placeholder={p.configured && f.secret ? '•••••••• (saved — leave blank to keep)' : ''}
									autocomplete="off"
								/>
							</div>
						{/each}
					</div>

					<div class="mt-4 flex items-center justify-end gap-2">
						<Button size="sm" variant="secondary" loading={testingProviderId === p.id} onclick={() => testProvider(p)}>
							Test connection
						</Button>
						<Button size="sm" loading={savingProviderId === p.id} onclick={() => saveProvider(p)}>Save</Button>
					</div>
				</Card>
			{/each}

			<Card title="Payment methods">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); savePayments() }}>
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Currency</label>
						<input class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase" bind:value={pCurrency} maxlength="10" />
					</div>
					<div class="space-y-2">
						{#each methods as m, i (m.id)}
							<div class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
								<span class="text-sm text-gray-800">{m.label}</span>
								<input type="checkbox" class="h-4 w-4 rounded border-gray-300" checked={m.enabled} onchange={() => (methods[i].enabled = !methods[i].enabled)} />
							</div>
						{/each}
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'shipping' && shipping}
			<Card title="Shipping">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveShipping() }}>
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Free shipping threshold</label>
						<input type="number" step="0.01" min="0" class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={freeShippingThreshold} />
					</div>
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="text-sm font-medium text-gray-700">Zones</p>
							<button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => zones = [...zones, { name: '', countriesText: '', rate: '0' }]}>
								+ Add zone
							</button>
						</div>
						<div class="space-y-3">
							{#each zones as z, i (i)}
								<div class="rounded-lg border border-gray-200 p-3">
									<div class="flex gap-2">
										<input class="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="Zone name" bind:value={zones[i].name} />
										<input type="number" step="0.01" min="0" class="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="Rate" bind:value={zones[i].rate} />
										<button type="button" class="px-2 text-gray-400 hover:text-red-600" onclick={() => zones = zones.filter((_, j) => j !== i)}>×</button>
									</div>
									<input class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="Countries (comma separated, e.g. US, CA)" bind:value={zones[i].countriesText} />
								</div>
							{/each}
							{#if zones.length === 0}
								<p class="py-6 text-center text-sm text-gray-400">No shipping zones configured.</p>
							{/if}
						</div>
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'taxes' && taxes}
			<Card title="Taxes">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveTaxes() }}>
					<div class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
						<span class="text-sm text-gray-700">Auto-calculate taxes</span>
						<input type="checkbox" class="h-4 w-4 rounded border-gray-300" bind:checked={autoCalculate} />
					</div>
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="text-sm font-medium text-gray-700">Rates</p>
							<button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => rates = [...rates, { region: '', rate: '0' }]}>
								+ Add rate
							</button>
						</div>
						<div class="space-y-2">
							{#each rates as r, i (i)}
								<div class="flex gap-2">
									<input class="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="Region (e.g. CA)" bind:value={rates[i].region} />
									<input type="number" step="0.01" min="0" max="100" class="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="%" bind:value={rates[i].rate} />
									<button type="button" class="px-2 text-gray-400 hover:text-red-600" onclick={() => rates = rates.filter((_, j) => j !== i)}>×</button>
								</div>
							{/each}
							{#if rates.length === 0}
								<p class="py-6 text-center text-sm text-gray-400">No tax rates configured.</p>
							{/if}
						</div>
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'notifications' && notifications}
			<Card title="Email notifications">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveNotifications() }}>
					<div class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
						<span class="text-sm text-gray-700">Send transactional emails</span>
						<input type="checkbox" class="h-4 w-4 rounded border-gray-300" bind:checked={nEnabled} />
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="notif-from-name" class="mb-1 block text-sm font-medium text-gray-700">Sender name</label>
							<input id="notif-from-name" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Defaults to store name" bind:value={nFromName} />
						</div>
						<div>
							<label for="notif-from-email" class="mb-1 block text-sm font-medium text-gray-700">Reply-to / sender address</label>
							<input id="notif-from-email" type="email" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="noreply@yourstore.com" bind:value={nFromEmail} />
						</div>
					</div>
				</form>

				<div class="mt-5 space-y-2">
					<p class="text-sm font-medium text-gray-700">Templates</p>
					{#each EMAIL_TEMPLATES as tpl (tpl.id)}
						<div class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2.5">
							<span class="text-sm text-gray-700">{tpl.label}</span>
							<input
								type="checkbox"
								class="h-4 w-4 rounded border-gray-300"
								checked={notifications.templates?.[tpl.id] !== false}
								onchange={(e) => toggleTemplate(tpl.id, (e.currentTarget as HTMLInputElement).checked)}
							/>
						</div>
					{/each}
				</div>

				<div class="mt-5 flex items-center justify-between gap-3">
					<p class="text-xs text-gray-400">Delivery runs via Resend when RESEND_API_KEY is configured; otherwise sends are logged only.</p>
					<Button loading={saving} onclick={saveNotifications}>Save</Button>
				</div>
			</Card>
		{:else if section === 'staff'}
			<Card padded={false}>
				<div class="flex items-center justify-between border-b border-gray-100 px-5 py-4">
					<h3 class="text-sm font-semibold text-gray-900">Staff members</h3>
					<Button size="sm" onclick={openNewStaff}>Add staff</Button>
				</div>
				{#if staff.length === 0}
					<p class="py-12 text-center text-sm text-gray-400">No staff members.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
									<th class="px-5 py-3">Name</th>
									<th class="px-3 py-3">Email</th>
									<th class="px-3 py-3">Role</th>
									<th class="px-3 py-3">Permissions</th>
									<th class="px-3 py-3">Status</th>
									<th class="px-5 py-3 text-right">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each staff as m (m.id)}
									<tr class="border-b border-gray-50 hover:bg-gray-50/60">
										<td class="px-5 py-3 font-medium text-gray-900">{m.name}</td>
										<td class="px-3 py-3 text-gray-600">{m.email}</td>
										<td class="px-3 py-3"><Badge label={m.role} /></td>
										<td class="px-3 py-3 text-gray-600">
											<span class="line-clamp-1">{m.permissions.length ? m.permissions.join(', ') : '—'}</span>
										</td>
										<td class="px-3 py-3"><Badge label={m.status} /></td>
										<td class="px-5 py-3 text-right whitespace-nowrap">
											<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => openEditStaff(m)}>Edit</button>
											<span class="mx-1 text-gray-300">|</span>
											<button class="text-xs font-medium text-gray-600 hover:text-gray-800" onclick={() => toggleStaff(m)}>{m.status === 'active' ? 'Disable' : 'Enable'}</button>
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
{/if}

{#if staffOpen && isAdmin()}
	<Modal title={editingStaff ? `Edit ${editingStaff.name}` : 'Add staff member'} open={true} width="sm" onClose={() => (staffOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveStaff() }}>
			<div>
				<label class="mb-1 block text-sm font-medium text-gray-700">Name *</label>
				<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={staffName} required />
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium text-gray-700">Email *</label>
				<input type="email" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={staffEmail} required />
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium text-gray-700">{editingStaff ? 'New password (leave blank to keep)' : 'Password *'}</label>
				<input type="password" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={staffPassword} minlength={editingStaff ? undefined : 10} required={!editingStaff} />
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium text-gray-700">Role</label>
				<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={staffRole}>
					<option value="admin">Admin</option>
					<option value="staff">Staff</option>
				</select>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium text-gray-700">Permissions</label>
				<div class="grid grid-cols-2 gap-2">
					{#each PERMISSIONS as p (p)}
						<label class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
							<input type="checkbox" class="h-4 w-4" checked={staffPerms.includes(p)} onchange={() => togglePerm(p)} />
							<span class="text-xs">{p}</span>
						</label>
					{/each}
				</div>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (staffOpen = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>{editingStaff ? 'Save' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}