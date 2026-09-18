<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { titleCase, currency } from '$lib/format'
	import { t } from '$lib/i18n'
	import type { Address, NotificationSettings, PaymentProviderView, PaymentSettings, Permission, ShippingRule, ShippingRuleType, ShippingSettings, StaffMember, StoreSettings, TaxSettings } from '$lib/types'

	type Section = 'store' | 'payments' | 'shipping' | 'taxes' | 'notifications' | 'staff' | 'cod' | 'checkout' | 'carriers' | 'pincode'
	let section = $state<Section>('store')
	let saving = $state(false)

	// store
	let store = $state<StoreSettings | null>(null)
	let sName = $state('')
	let sCurrency = $state('')
	let sTimezone = $state('')
	let sAnnouncement = $state('')
	let sCountry = $state('')
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
	let rules = $state<
		Array<{
			id: string
			type: ShippingRuleType
			name: string
			rate: string
			enabled: boolean
			country: string
			state: string
			city: string
			postalCode: string
			freeAbove: string
		}>
	>([])

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

	interface CodSettings {
		merchantId: string
		serviceablePincodes: string[]
		blacklistPincodes: string[]
		minOrderValue: number
		maxOrderValue: number | null
		codFee: number
		enabled: boolean
	}

	interface CheckoutSettings {
		merchantId: string
		codEnabled: boolean
		codMinValue: number
		codMaxValue: number | null
		codFee: number
		serviceablePincodes: string[]
		defaultShippingDays: number
		requiredFields: Record<string, boolean>
	}

	interface Carrier {
		id: string
		merchantId: string
		name: string
		code: string
		enabled: boolean
		credentials: Record<string, unknown>
		config: Record<string, unknown>
		createdAt: string
		updatedAt: string
	}

	interface ServiceabilityResult {
		pincode: string
		serviceable: boolean
		codAvailable: boolean
		estimatedDeliveryDays: number
		shippingFee: number | null
	}

	let codSettings = $state<CodSettings | null>(null)
	let codEnabled = $state(true)
	let codServiceableText = $state('')
	let codBlacklistText = $state('')
	let codMin = $state('0')
	let codMax = $state('')
	let codFee = $state('0')

	let checkoutSettings = $state<CheckoutSettings | null>(null)
	let coCodEnabled = $state(true)
	let coCodMin = $state('0')
	let coCodMax = $state('')
	let coCodFee = $state('0')
	let coServiceableText = $state('')
	let coDefaultShippingDays = $state('5')
	let coRequired = $state<Record<string, boolean>>({})

	let carriers = $state<Carrier[] | null>(null)
	let carrierOpen = $state(false)
	let editingCarrier = $state<Carrier | null>(null)
	let carrierName = $state('')
	let carrierCode = $state('')
	let carrierEnabled = $state(true)
	let carrierSaving = $state(false)
	let deletingCarrierId = $state('')

	let pincodeInput = $state('')
	let pincodeResult = $state<ServiceabilityResult | null>(null)
	let pincodeLoading = $state(false)

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
				const [storeRes, merchantRes] = await Promise.all([
					api.get<{ success: boolean; data: StoreSettings }>('/api/settings/store'),
					api.get<{ success: boolean; data: { id: string; name: string; slug: string; currency: string; timezone: string; country: string | null } }>('/api/settings/merchant')
				])
				store = storeRes.data
				sName = storeRes.data.name
				sCurrency = storeRes.data.currency
				sTimezone = storeRes.data.timezone
				sAnnouncement = storeRes.data.announcement
				sCountry = merchantRes.data.country ?? ''
				addr = { ...storeRes.data.address }
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
				rules = (res.data.rules ?? []).map((r) => ({
					id: r.id,
					type: r.type,
					name: r.name,
					rate: String(r.rate),
					enabled: r.enabled,
					country: r.country ?? '',
					state: r.state ?? '',
					city: r.city ?? '',
					postalCode: r.postalCode ?? '',
					freeAbove: r.freeAbove === undefined ? '' : String(r.freeAbove)
				}))
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
			} else if (section === 'cod') {
				await loadCodSettings()
			} else if (section === 'checkout') {
				await loadCheckoutSettings()
			} else if (section === 'carriers') {
				await loadCarriers()
			} else if (section === 'pincode') {
				pincodeResult = null
			} else {
				const res = await api.get<{ success: boolean; data: StaffMember[] }>('/api/settings/staff')
				staff = res.data
			}
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(() => {
		load()
		loadCodSettings()
		loadCheckoutSettings()
		loadCarriers()
	})

	function switchSection(s: Section) {
		section = s
		load()
	}

	async function saveStore() {
		saving = true
		try {
			await Promise.all([
				api.put<{ success: boolean; data: StoreSettings }>('/api/settings/store', {
					name: sName,
					currency: sCurrency,
					timezone: sTimezone,
					announcement: sAnnouncement,
					address: addr
				}),
				api.put<{ success: boolean; data: { country: string | null } }>('/api/settings/merchant', {
					country: sCountry.trim() || null
				})
			])
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
			rules: rules.map((r) => ({
				id: r.id,
				type: r.type,
				name: r.name,
				rate: Number(r.rate),
				enabled: r.enabled,
				freeAbove: r.freeAbove.trim() === '' ? undefined : Number(r.freeAbove),
				country: r.country.trim() || undefined,
				state: r.state.trim() || undefined,
				city: r.city.trim() || undefined,
				postalCode: r.type === 'pin' ? r.postalCode.trim() : undefined
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

	function splitPincodes(s: string) {
		return s.split(',').map((p) => p.trim()).filter(Boolean)
	}

	async function loadCodSettings() {
		try {
			const res = await api.get<{ success: boolean; data: CodSettings }>('/api/settings/cod')
			codSettings = res.data
			codEnabled = res.data.enabled
			codServiceableText = res.data.serviceablePincodes.join(', ')
			codBlacklistText = res.data.blacklistPincodes.join(', ')
			codMin = String(res.data.minOrderValue)
			codMax = res.data.maxOrderValue === null ? '' : String(res.data.maxOrderValue)
			codFee = String(res.data.codFee)
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function loadCheckoutSettings() {
		try {
			const res = await api.get<{ success: boolean; data: CheckoutSettings }>('/api/settings/checkout')
			checkoutSettings = res.data
			coCodEnabled = res.data.codEnabled
			coCodMin = String(res.data.codMinValue)
			coCodMax = res.data.codMaxValue === null ? '' : String(res.data.codMaxValue)
			coCodFee = String(res.data.codFee)
			coServiceableText = res.data.serviceablePincodes.join(', ')
			coDefaultShippingDays = String(res.data.defaultShippingDays)
			coRequired = { ...res.data.requiredFields }
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function loadCarriers() {
		try {
			const res = await api.get<Carrier[]>('/api/settings/carriers')
			carriers = res
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function saveCod() {
		saving = true
		try {
			const res = await api.put<{ success: boolean; data: CodSettings }>('/api/settings/cod', {
				enabled: codEnabled,
				serviceablePincodes: splitPincodes(codServiceableText),
				blacklistPincodes: splitPincodes(codBlacklistText),
				minOrderValue: Number(codMin),
				maxOrderValue: codMax.trim() === '' ? null : Number(codMax),
				codFee: Number(codFee)
			})
			codSettings = res.data
			toast.success('COD settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function saveCheckout() {
		saving = true
		try {
			const res = await api.put<{ success: boolean; data: CheckoutSettings }>('/api/settings/checkout', {
				codEnabled: coCodEnabled,
				codMinValue: Number(coCodMin),
				codMaxValue: coCodMax.trim() === '' ? null : Number(coCodMax),
				codFee: Number(coCodFee),
				serviceablePincodes: splitPincodes(coServiceableText),
				defaultShippingDays: Number(coDefaultShippingDays),
				requiredFields: coRequired
			})
			checkoutSettings = res.data
			toast.success('Checkout settings saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	function openNewCarrier() {
		editingCarrier = null
		carrierName = ''
		carrierCode = ''
		carrierEnabled = true
		carrierOpen = true
	}

	function openEditCarrier(c: Carrier) {
		editingCarrier = c
		carrierName = c.name
		carrierCode = c.code
		carrierEnabled = c.enabled
		carrierOpen = true
	}

	async function saveCarrier() {
		if (!carrierName.trim()) {
			toast.error('Name is required')
			return
		}
		if (!carrierCode.trim()) {
			toast.error('Code is required')
			return
		}
		carrierSaving = true
		try {
			if (editingCarrier) {
				await api.put<{ success: boolean; data: Carrier }>(`/api/settings/carriers/${editingCarrier.id}`, {
					name: carrierName.trim(),
					code: carrierCode.trim(),
					enabled: carrierEnabled,
					credentials: editingCarrier.credentials,
					config: editingCarrier.config
				})
				toast.success('Carrier updated')
			} else {
				const res = await api.post<{ success: boolean; data: Carrier }>('/api/settings/carriers', {
					name: carrierName.trim(),
					code: carrierCode.trim(),
					enabled: carrierEnabled,
					credentials: {},
					config: {}
				})
				carriers = [...(carriers ?? []), res.data]
				toast.success('Carrier created')
			}
			carrierOpen = false
			await loadCarriers()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			carrierSaving = false
		}
	}

	async function deleteCarrier(c: Carrier) {
		if (!confirm(`Delete carrier ${c.name}?`)) return
		deletingCarrierId = c.id
		try {
			await api.delete<{ success: boolean; data: { deleted: boolean } }>(`/api/settings/carriers/${c.id}`)
			carriers = (carriers ?? []).filter((x) => x.id !== c.id)
			toast.success('Carrier deleted')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			deletingCarrierId = ''
		}
	}

	async function checkPincode() {
		const code = pincodeInput.trim()
		if (!code) {
			toast.error('Enter a pincode')
			return
		}
		pincodeLoading = true
		try {
			const res = await api.get<{ success: boolean; data: ServiceabilityResult }>(`/api/settings/serviceability/${encodeURIComponent(code)}`)
			pincodeResult = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			pincodeLoading = false
		}
	}

	const sections: Array<{ id: Section; label: string }> = [
		{ id: 'store', label: 'Store' },
		{ id: 'payments', label: 'Payments' },
		{ id: 'shipping', label: 'Shipping' },
		{ id: 'taxes', label: 'Taxes' },
		{ id: 'cod', label: 'COD' },
		{ id: 'checkout', label: 'Checkout' },
		{ id: 'carriers', label: 'Carriers' },
		{ id: 'pincode', label: 'Pincode lookup' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'staff', label: 'Staff' }
	]
</script>

<svelte:head><title>{t('settings.title')} — JamiCore</title></svelte:head>

{#if !isAdmin()}
	<div class="rounded-xl border border-warning/30 bg-warning/10 p-6 text-sm text-warning">
		{t('settings.adminRequired')}
	</div>
{:else}
	<div class="space-y-5">
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<h1 class="font-display text-display text-on-surface">{t('settings.title')}</h1>
		</div>

		<div class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
			{#each sections as s (s.id)}
				<button class="rounded-md px-3 py-1.5 text-sm font-medium max-sm:min-h-11 max-sm:inline-flex max-sm:items-center transition-colors {section === s.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}" onclick={() => switchSection(s.id)}>
					{s.label}
				</button>
			{/each}
		</div>

		{#if section === 'store' && store}
			<Card title="Store settings" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveStore() }}>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="store-name" class="field-label">Store name</label>
							<input id="store-name" class="field" bind:value={sName} required />
						</div>
						<div>
							<label for="store-currency" class="field-label">Currency</label>
							<input id="store-currency" class="field uppercase" bind:value={sCurrency} maxlength="10" />
						</div>
						<div>
							<label for="store-timezone" class="field-label">Timezone</label>
							<input id="store-timezone" class="field" bind:value={sTimezone} placeholder="UTC" />
						</div>
						<div>
							<label for="store-announcement" class="field-label">Announcement</label>
							<input id="store-announcement" class="field" bind:value={sAnnouncement} />
						</div>
						<div>
							<label for="store-country" class="field-label">Home country</label>
							<input id="store-country" class="field uppercase" bind:value={sCountry} maxlength="3" placeholder="KW" />
							<p class="mt-1 text-[11px] text-outline">Restricts storefront delivery to this country when no shipping zone lists countries.</p>
						</div>
					</div>

					<div>
						<p class="field-label mb-2">Address</p>
						<div class="grid gap-3 sm:grid-cols-2">
							<input class="field" placeholder="Name" bind:value={addr.name} />
							<input class="field" placeholder="Line 1" bind:value={addr.line1} />
							<input class="field" placeholder="Line 2" bind:value={addr.line2} />
							<input class="field" placeholder="City" bind:value={addr.city} />
							<input class="field" placeholder="State" bind:value={addr.state} />
							<input class="field" placeholder="Postal code" bind:value={addr.postalCode} />
							<input class="field" placeholder="Country" bind:value={addr.country} />
							<input class="field" placeholder="Phone" bind:value={addr.phone} />
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
								<h2 class="text-sm font-semibold text-on-surface">{p.label}</h2>
								<Badge label={p.mode} />
								<span class="text-[11px] font-medium {p.configured ? 'text-success' : 'text-outline'}">
									{p.configured ? '● credentials saved' : '○ not configured'}
								</span>
							</div>
							<p class="mt-1 max-w-xl text-xs text-secondary">{p.description}</p>
							{#if p.currencies.length}
								<p class="mt-1 text-[11px] text-outline">Currencies: {p.currencies.join(', ')}</p>
							{/if}
						</div>
						<label class="flex shrink-0 cursor-pointer items-center gap-2">
							<input type="checkbox" class="field-check" checked={p.enabled} onchange={() => toggleProvider(p)} />
							<span class="text-xs font-medium text-secondary">{p.enabled ? 'Enabled' : 'Disabled'}</span>
						</label>
					</div>

					<div class="mt-4 grid gap-3 sm:grid-cols-2">
						<div>
							<label class="field-label" for={`${p.id}-mode`}>Mode</label>
							<select
								id={`${p.id}-mode`}
								class="field"
								bind:value={p.mode}
							>
								<option value="test">Test / Sandbox</option>
								<option value="live">Live</option>
							</select>
						</div>
						{#if p.countries}
							<div>
								<label class="field-label" for={`${p.id}-country`}>Account country</label>
								<select
									id={`${p.id}-country`}
									class="field"
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
								<label class="field-label" for={`${p.id}-${f.key}`}>
									{f.label}{f.required ? ' *' : ''}
								</label>
								<input
									id={`${p.id}-${f.key}`}
									type={f.secret ? 'password' : 'text'}
									class="field"
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

			<Card title="Payment methods" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); savePayments() }}>
					<div>
						<label for="payments-currency" class="field-label">Currency</label>
						<input id="payments-currency" class="field w-40 uppercase" bind:value={pCurrency} maxlength="10" />
					</div>
					<div class="space-y-2">
						{#each methods as m, i (m.id)}
							<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
								<span class="text-sm text-on-surface-variant">{m.label}</span>
								<input type="checkbox" class="field-check" checked={m.enabled} onchange={() => (methods[i].enabled = !methods[i].enabled)} />
							</div>
						{/each}
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'shipping' && shipping}
			<Card title="Shipping" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveShipping() }}>
					<div>
						<label for="free-shipping-threshold" class="field-label">Free shipping threshold</label>
						<input id="free-shipping-threshold" type="number" step="0.01" min="0" class="field w-40" bind:value={freeShippingThreshold} />
					</div>
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="field-label">Zones</p>
							<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => zones = [...zones, { name: '', countriesText: '', rate: '0' }]}>
								+ Add zone
							</button>
						</div>
						<div class="space-y-3">
							{#each zones as z, i (i)}
								<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
									<div class="flex gap-2">
										<input class="field flex-1" placeholder="Zone name" bind:value={zones[i].name} />
										<input type="number" step="0.01" min="0" class="field w-28" placeholder="Rate" bind:value={zones[i].rate} />
										<button type="button" class="rounded p-1.5 text-sm text-outline hover:bg-error-container/40 hover:text-error" onclick={() => zones = zones.filter((_, j) => j !== i)}>×</button>
									</div>
									<input class="field mt-2 w-full" placeholder="Countries (comma separated, e.g. US, CA)" bind:value={zones[i].countriesText} />
								</div>
							{/each}
							{#if zones.length === 0}
								<p class="py-6 text-center text-sm text-outline">No shipping zones configured.</p>
							{/if}
						</div>
					</div>
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="field-label">Delivery rules</p>
							<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => rules = [...rules, { id: crypto.randomUUID(), type: 'default', name: '', rate: '0', enabled: true, country: '', state: '', city: '', postalCode: '', freeAbove: '' }]}>
								+ Add rule
							</button>
						</div>
						<p class="mb-3 text-[11px] text-outline">Matched in order: PIN → City → State → Country → Default. A PIN ending in * is a prefix match (e.g. 1100*).</p>
						<div class="space-y-3">
							{#each rules as r, i (r.id)}
								<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
									<div class="flex flex-wrap gap-2">
										<select class="field w-32" bind:value={rules[i].type}>
											<option value="pin">PIN</option>
											<option value="city">City</option>
											<option value="state">State</option>
											<option value="country">Country</option>
											<option value="default">Default</option>
										</select>
										<input class="field flex-1" placeholder="Rule name" bind:value={rules[i].name} />
										<input type="number" step="0.01" min="0" class="field w-28" placeholder="Rate" bind:value={rules[i].rate} />
										<label class="flex items-center gap-1.5 self-center text-xs text-secondary">
											<input type="checkbox" class="field-check" bind:checked={rules[i].enabled} />
											Enabled
										</label>
										<button type="button" class="rounded p-1.5 text-sm text-outline hover:bg-error-container/40 hover:text-error" onclick={() => rules = rules.filter((_, j) => j !== i)}>×</button>
									</div>
									{#if rules[i].type === 'country'}
										<input class="field mt-2 w-40 uppercase" placeholder="Country (e.g. KW)" maxlength="3" bind:value={rules[i].country} />
									{:else if rules[i].type === 'state'}
										<div class="mt-2 flex gap-2">
											<input class="field flex-1" placeholder="State" bind:value={rules[i].state} />
											<input class="field w-40 uppercase" placeholder="Country" maxlength="3" bind:value={rules[i].country} />
										</div>
									{:else if rules[i].type === 'city'}
										<div class="mt-2 flex gap-2">
											<input class="field flex-1" placeholder="City" bind:value={rules[i].city} />
											<input class="field w-40 uppercase" placeholder="Country" maxlength="3" bind:value={rules[i].country} />
										</div>
									{:else if rules[i].type === 'pin'}
										<div class="mt-2 flex gap-2">
											<input class="field flex-1" placeholder="PIN (e.g. 1100*)" bind:value={rules[i].postalCode} />
											<input class="field w-40 uppercase" placeholder="Country" maxlength="3" bind:value={rules[i].country} />
										</div>
									{:else}
										<p class="mt-2 text-[11px] text-outline">Fallback rate when no other rule matches.</p>
									{/if}
									<input type="number" step="0.01" min="0" class="field mt-2 w-40" placeholder="Free above (optional)" bind:value={rules[i].freeAbove} />
								</div>
							{/each}
							{#if rules.length === 0}
								<p class="py-6 text-center text-sm text-outline">No delivery rules configured — legacy zones are used.</p>
							{/if}
						</div>
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'taxes' && taxes}
			<Card title="Taxes" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveTaxes() }}>
					<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
						<span class="text-sm text-on-surface-variant">Auto-calculate taxes</span>
						<input type="checkbox" class="field-check" bind:checked={autoCalculate} />
					</div>
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="field-label">Rates</p>
							<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => rates = [...rates, { region: '', rate: '0' }]}>
								+ Add rate
							</button>
						</div>
						<div class="space-y-2">
							{#each rates as r, i (i)}
								<div class="flex gap-2">
									<input class="field flex-1" placeholder="Region (e.g. CA)" bind:value={rates[i].region} />
									<input type="number" step="0.01" min="0" max="100" class="field w-28" placeholder="%" bind:value={rates[i].rate} />
									<button type="button" class="rounded p-1.5 text-sm text-outline hover:bg-error-container/40 hover:text-error" onclick={() => rates = rates.filter((_, j) => j !== i)}>×</button>
								</div>
							{/each}
							{#if rates.length === 0}
								<p class="py-6 text-center text-sm text-outline">No tax rates configured.</p>
							{/if}
						</div>
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'cod' && codSettings}
			<Card title="Cash on delivery" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveCod() }}>
					<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
						<span class="text-sm text-on-surface-variant">Enable cash on delivery</span>
						<input type="checkbox" class="field-check" bind:checked={codEnabled} />
					</div>
					<div class="grid gap-3 sm:grid-cols-3">
						<div>
							<label for="cod-min" class="field-label">Minimum order value</label>
							<input id="cod-min" type="number" step="0.01" min="0" class="field" bind:value={codMin} />
						</div>
						<div>
							<label for="cod-max" class="field-label">Maximum order value</label>
							<input id="cod-max" type="number" step="0.01" min="0" class="field" bind:value={codMax} placeholder="Optional" />
						</div>
						<div>
							<label for="cod-fee" class="field-label">COD fee</label>
							<input id="cod-fee" type="number" step="0.01" min="0" class="field" bind:value={codFee} />
						</div>
					</div>
					<div>
						<label for="cod-serviceable" class="field-label">Serviceable pincodes (comma separated)</label>
						<textarea id="cod-serviceable" class="field min-h-24" bind:value={codServiceableText} placeholder="e.g. 110001, 400001"></textarea>
					</div>
					<div>
						<label for="cod-blacklist" class="field-label">Blocked pincodes (comma separated)</label>
						<textarea id="cod-blacklist" class="field min-h-24" bind:value={codBlacklistText} placeholder="e.g. 560001, 700001"></textarea>
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'checkout' && checkoutSettings}
			<Card title="Checkout" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveCheckout() }}>
					<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
						<span class="text-sm text-on-surface-variant">Enable cash on delivery at checkout</span>
						<input type="checkbox" class="field-check" bind:checked={coCodEnabled} />
					</div>
					<div class="grid gap-3 sm:grid-cols-3">
						<div>
							<label for="co-min" class="field-label">Minimum order value</label>
							<input id="co-min" type="number" step="0.01" min="0" class="field" bind:value={coCodMin} />
						</div>
						<div>
							<label for="co-max" class="field-label">Maximum order value</label>
							<input id="co-max" type="number" step="0.01" min="0" class="field" bind:value={coCodMax} placeholder="Optional" />
						</div>
						<div>
							<label for="co-fee" class="field-label">COD fee</label>
							<input id="co-fee" type="number" step="0.01" min="0" class="field" bind:value={coCodFee} />
						</div>
						<div>
							<label for="co-days" class="field-label">Default shipping days</label>
							<input id="co-days" type="number" step="1" min="0" class="field" bind:value={coDefaultShippingDays} />
						</div>
					</div>
					<div>
						<label for="co-serviceable" class="field-label">Serviceable pincodes (comma separated)</label>
						<textarea id="co-serviceable" class="field min-h-24" bind:value={coServiceableText} placeholder="e.g. 110001, 400001"></textarea>
					</div>
					<div>
						<p class="field-label mb-2">Required checkout fields</p>
						{#each Object.entries({ email: 'Email', phone: 'Phone', name: 'Full name', line1: 'Address', line2: 'Apartment / suite', city: 'City', state: 'State', postalCode: 'PIN code', country: 'Country' }) as [id, label] (id)}
							<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
								<span class="text-sm text-on-surface-variant">{label}</span>
								<input type="checkbox" class="field-check" checked={coRequired[id]} onchange={() => (coRequired[id] = !coRequired[id])} />
							</div>
						{/each}
						<p class="mt-2 text-[11px] text-outline">Email is optional by default; the rest are required.</p>
					</div>
					<div class="flex justify-end">
						<Button type="submit" loading={saving}>Save</Button>
					</div>
				</form>
			</Card>
		{:else if section === 'carriers'}
			<Card padded={false}>
				<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
					<h2 class="text-sm font-semibold text-on-surface">Carriers</h2>
					<Button size="sm" onclick={openNewCarrier}>Add carrier</Button>
				</div>
				{#if carriers === null}
					<div class="space-y-2 p-5">
						{#each Array(3) as _}
							<div class="h-10 animate-pulse rounded bg-surface-container"></div>
						{/each}
					</div>
				{:else if carriers.length === 0}
					<div class="flex flex-col items-center gap-2 py-14 text-center">
						<Icon name="local_shipping" size="text-[32px]" class="text-outline" />
						<p class="text-sm text-secondary">No carriers configured.</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<tr>
									<th class="px-5 py-3 font-semibold">Name</th>
									<th class="px-3 py-3 font-semibold">Code</th>
									<th class="px-3 py-3 font-semibold">Status</th>
									<th class="px-5 py-3 text-right font-semibold">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each carriers as c (c.id)}
									<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
										<td class="px-5 py-3 font-medium text-on-surface">{c.name}</td>
										<td class="px-3 py-3 font-mono text-xs text-secondary">{c.code}</td>
										<td class="px-3 py-3"><Badge label={c.enabled ? 'active' : 'disabled'} /></td>
										<td class="px-5 py-3 text-right whitespace-nowrap">
											<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditCarrier(c)}>Edit</button>
											<span class="mx-1 text-outline">|</span>
											<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface disabled:opacity-50" disabled={deletingCarrierId === c.id} onclick={() => deleteCarrier(c)}>{deletingCarrierId === c.id ? 'Deleting…' : 'Delete'}</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card>
		{:else if section === 'pincode'}
			<Card title="Pincode lookup" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); checkPincode() }}>
					<div class="flex items-end gap-2">
						<div class="flex-1">
							<label for="pincode-input" class="field-label">Pincode</label>
							<input id="pincode-input" class="field" bind:value={pincodeInput} maxlength="10" placeholder="e.g. 110001" />
						</div>
						<Button type="submit" loading={pincodeLoading}>Check</Button>
					</div>
				</form>
				{#if pincodeResult}
					<div class="mt-5 rounded-lg border border-outline-variant bg-surface-container-lowest p-4">
						<div class="mb-3 flex items-center justify-between">
							<span class="font-mono text-sm font-medium text-on-surface">{pincodeResult.pincode}</span>
							<Badge label={pincodeResult.serviceable ? 'active' : 'inactive'} />
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<div>
								<p class="field-label">COD available</p>
								<div><Badge label={pincodeResult.codAvailable ? 'active' : 'inactive'} /></div>
							</div>
							<div>
								<p class="field-label">Estimated delivery</p>
								<p class="text-sm font-medium text-on-surface">{pincodeResult.estimatedDeliveryDays} days</p>
							</div>
							<div>
								<p class="field-label">Shipping fee</p>
								<p class="text-sm font-medium text-on-surface">{pincodeResult.shippingFee === null ? '—' : currency(pincodeResult.shippingFee, sCurrency || 'USD')}</p>
							</div>
						</div>
					</div>
				{/if}
			</Card>
		{:else if section === 'notifications' && notifications}
			<Card title="Email notifications" headingLevel="h2">
				<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveNotifications() }}>
					<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
						<span class="text-sm text-on-surface-variant">Send transactional emails</span>
						<input type="checkbox" class="field-check" bind:checked={nEnabled} />
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="notif-from-name" class="field-label">Sender name</label>
							<input id="notif-from-name" class="field" placeholder="Defaults to store name" bind:value={nFromName} />
						</div>
						<div>
							<label for="notif-from-email" class="field-label">Reply-to / sender address</label>
							<input id="notif-from-email" type="email" class="field" placeholder="noreply@yourstore.com" bind:value={nFromEmail} />
						</div>
					</div>
				</form>

				<div class="mt-5 space-y-2">
					<p class="field-label">Templates</p>
					{#each EMAIL_TEMPLATES as tpl (tpl.id)}
						<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2.5">
							<span class="text-sm text-on-surface-variant">{tpl.label}</span>
							<input
								type="checkbox"
								class="field-check"
								checked={notifications.templates?.[tpl.id] !== false}
								onchange={(e) => toggleTemplate(tpl.id, (e.currentTarget as HTMLInputElement).checked)}
							/>
						</div>
					{/each}
				</div>

				<div class="mt-5 flex items-center justify-between gap-3">
					<p class="text-xs text-outline">Delivery runs via Resend when RESEND_API_KEY is configured; otherwise sends are logged only.</p>
					<Button loading={saving} onclick={saveNotifications}>Save</Button>
				</div>
			</Card>
		{:else if section === 'staff'}
			<Card padded={false}>
				<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
					<h2 class="text-sm font-semibold text-on-surface">Staff members</h2>
					<Button size="sm" onclick={openNewStaff}>Add staff</Button>
				</div>
				{#if staff.length === 0}
					<div class="flex flex-col items-center gap-2 py-14 text-center">
						<Icon name="group" size="text-[32px]" class="text-outline" />
						<p class="text-sm text-secondary">No staff members.</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="border-b border-outline-variant text-left font-table-header text-table-header uppercase tracking-wider text-secondary">
								<tr>
									<th class="px-5 py-3 font-semibold">Name</th>
									<th class="px-3 py-3 font-semibold">Email</th>
									<th class="px-3 py-3 font-semibold">Role</th>
									<th class="px-3 py-3 font-semibold">Permissions</th>
									<th class="px-3 py-3 font-semibold">Status</th>
									<th class="px-5 py-3 text-right font-semibold">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each staff as m (m.id)}
									<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
										<td class="px-5 py-3 font-medium text-on-surface">{m.name}</td>
										<td class="px-3 py-3 text-on-surface-variant">{m.email}</td>
										<td class="px-3 py-3"><Badge label={m.role} /></td>
										<td class="px-3 py-3 text-on-surface-variant">
											<span class="line-clamp-1">{m.permissions.length ? m.permissions.join(', ') : '—'}</span>
										</td>
										<td class="px-3 py-3"><Badge label={m.status} /></td>
										<td class="px-5 py-3 text-right whitespace-nowrap">
											<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditStaff(m)}>Edit</button>
											<span class="mx-1 text-outline">|</span>
											<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => toggleStaff(m)}>{m.status === 'active' ? 'Disable' : 'Enable'}</button>
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
				<label for="staff-name" class="field-label">Name *</label>
				<input id="staff-name" class="field" bind:value={staffName} required />
			</div>
			<div>
				<label class="field-label">Email *</label>
				<input type="email" class="field" bind:value={staffEmail} required />
			</div>
			<div>
				<label class="field-label">{editingStaff ? 'New password (leave blank to keep)' : 'Password *'}</label>
				<input type="password" class="field" bind:value={staffPassword} minlength={editingStaff ? undefined : 10} required={!editingStaff} />
			</div>
			<div>
				<label class="field-label">Role</label>
				<select class="field" bind:value={staffRole}>
					<option value="admin">Admin</option>
					<option value="staff">Staff</option>
				</select>
			</div>
			<div>
				<label class="field-label">Permissions</label>
				<div class="grid grid-cols-2 gap-2">
					{#each PERMISSIONS as p (p)}
						<label class="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface-variant">
							<input type="checkbox" class="field-check" checked={staffPerms.includes(p)} onchange={() => togglePerm(p)} />
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

{#if carrierOpen && isAdmin()}
	<Modal title={editingCarrier ? `Edit ${editingCarrier.name}` : 'Add carrier'} open={true} width="sm" onClose={() => (carrierOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveCarrier() }}>
			<div>
				<label for="carrier-name" class="field-label">Name *</label>
				<input id="carrier-name" class="field" bind:value={carrierName} placeholder="e.g. BlueDart" required />
			</div>
			<div>
				<label for="carrier-code" class="field-label">Code *</label>
				<input id="carrier-code" class="field font-mono" bind:value={carrierCode} placeholder="e.g. BLUEDART" required />
			</div>
			<div class="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
				<span class="text-sm text-on-surface-variant">Enable carrier</span>
				<input type="checkbox" class="field-check" bind:checked={carrierEnabled} />
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (carrierOpen = false)}>Cancel</Button>
				<Button type="submit" loading={carrierSaving}>{editingCarrier ? 'Save' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}