<script lang="ts">
	import { ApiError } from '$lib/api'
	import { account } from '$lib/account.svelte'
	import { money } from '$lib/format'
	import { t } from '$lib/i18n'
	import type { ShopperAddress, ShopperAddressInput, ShopperOrderSummary } from '$lib/types'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const slug = $derived(data.slug)

	$effect(() => {
		account.setSlug(slug)
	})

	let mode = $state<'login' | 'register'>('login')
	let email = $state('')
	let password = $state('')
	let firstName = $state('')
	let lastName = $state('')
	let claimOrderNumber = $state('')
	let authError = $state('')
	let submitting = $state(false)

	let currentPassword = $state('')
	let newPassword = $state('')
	let pwMessage = $state<{ kind: 'ok' | 'err'; text: string } | null>(null)
	let pwSubmitting = $state(false)

	// profile
	let profFirstName = $state('')
	let profLastName = $state('')
	let profPhone = $state('')
	let profMessage = $state<{ kind: 'ok' | 'err'; text: string } | null>(null)
	let profSubmitting = $state(false)
	let profInitialized = $state(false)

	// email verification
	let verifyMessage = $state('')

	// address book
	let addresses = $state<ShopperAddress[]>([])
	let addressesError = $state('')
	let addressesLoading = $state(false)
	let editingAddress = $state<ShopperAddress | null>(null)
	let showAddressForm = $state(false)
	let addressSubmitting = $state(false)
	let addr = $state<ShopperAddressInput>({
		label: 'default',
		addressType: 'both',
		line1: '',
		country: ''
	})

	let orders = $state<ShopperOrderSummary[]>([])
	let ordersError = $state('')
	let ordersLoading = $state(false)
	let ordersLoadedFor = $state('')

	$effect(() => {
		if (account.signedIn && ordersLoadedFor !== account.customer?.id) {
			loadOrders()
		}
	})

	$effect(() => {
		if (account.signedIn && account.customer && !profInitialized) {
			profFirstName = account.customer.firstName ?? ''
			profLastName = account.customer.lastName ?? ''
			profPhone = account.customer.phone ?? ''
			profInitialized = true
		}
	})

	$effect(() => {
		if (account.signedIn && addresses.length === 0 && !addressesLoading) {
			loadAddresses()
		}
	})

	async function loadOrders() {
		if (!account.customer) return
		ordersLoading = true
		ordersError = ''
		try {
			const page = await account.orders(fetch, { limit: 20 })
			orders = page.items
			ordersLoadedFor = account.customer.id
		} catch (e) {
			if (account.isAuthError(e)) {
				account.logout()
				return
			}
			ordersError = e instanceof ApiError ? e.message : t('account.loadFailed')
		} finally {
			ordersLoading = false
		}
	}

	const submitAuth = async (event: SubmitEvent) => {
		event.preventDefault()
		authError = ''
		if (!email.trim() || !password) {
			authError = t('account.emailPasswordRequired')
			return
		}
		submitting = true
		try {
			if (mode === 'login') {
				await account.login(fetch, { email: email.trim(), password })
			} else {
				await account.register(fetch, {
					email: email.trim(),
					password,
					firstName: firstName.trim() || undefined,
					lastName: lastName.trim() || undefined,
					orderNumber: claimOrderNumber.trim() || undefined
				})
			}
			password = ''
			ordersLoadedFor = ''
		} catch (e) {
			authError = e instanceof ApiError ? e.message : t('account.genericError')
		} finally {
			submitting = false
		}
	}

	async function changePassword(event: SubmitEvent) {
		event.preventDefault()
		pwMessage = null
		if (newPassword.length < 8) {
			pwMessage = { kind: 'err', text: t('account.passwordMinLength') }
			return
		}
		pwSubmitting = true
		try {
			await account.changePassword(fetch, { currentPassword, newPassword })
			pwMessage = { kind: 'ok', text: t('account.passwordUpdated') }
			currentPassword = ''
			newPassword = ''
		} catch (e) {
			if (account.isAuthError(e)) {
				account.logout()
				return
			}
			pwMessage = {
				kind: 'err',
				text: e instanceof ApiError ? e.message : t('account.passwordUpdateFailed')
			}
		} finally {
			pwSubmitting = false
		}
	}

	const statusLabel = (status: string) =>
		status === 'paid' ? t('orders.paid') : status === 'failed' ? t('orders.failed') : status === 'refunded' ? t('orders.refunded') : status

	const addressLines = (a: ShopperAddress) =>
		[a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), a.postalCode, a.country].filter(Boolean).join(', ')

	const fullName = (a: ShopperAddress) => a.name || ([account.customer?.firstName, account.customer?.lastName].filter(Boolean).join(' ') || '')

	const resetAddressForm = (a?: ShopperAddress | null) => {
		addr = {
			label: a?.label ?? 'default',
			addressType: a?.addressType ?? 'both',
			name: a?.name ?? '',
			company: a?.company ?? '',
			line1: a?.line1 ?? '',
			line2: a?.line2 ?? '',
			city: a?.city ?? '',
			state: a?.state ?? '',
			postalCode: a?.postalCode ?? '',
			country: a?.country ?? '',
			phone: a?.phone ?? ''
		}
		editingAddress = a ?? null
		showAddressForm = true
	}

	async function loadAddresses() {
		if (!account.signedIn) return
		addressesLoading = true
		addressesError = ''
		try {
			addresses = await account.addresses(fetch)
		} catch (e) {
			if (account.isAuthError(e)) return
			addressesError = t('account.genericError')
		} finally {
			addressesLoading = false
		}
	}

	async function saveProfile(event: SubmitEvent) {
		event.preventDefault()
		profMessage = null
		profSubmitting = true
		try {
			await account.updateProfile(fetch, {
				firstName: profFirstName,
				lastName: profLastName,
				phone: profPhone
			})
			profMessage = { kind: 'ok', text: t('accountProfile.updated') }
		} catch (e) {
			profMessage = {
				kind: 'err',
				text: e instanceof ApiError ? e.message : t('accountProfile.updateFailed')
			}
		} finally {
			profSubmitting = false
		}
	}

	async function resendVerification() {
		verifyMessage = ''
		try {
			await account.resendVerification(fetch)
			verifyMessage = t('accountVerify.resent')
		} catch (e) {
			if (account.isAuthError(e)) return
			verifyMessage = t('account.genericError')
		}
	}

	async function saveAddress(event: SubmitEvent) {
		event.preventDefault()
		addressesError = ''
		if (!addr.line1.trim()) {
			addressesError = t('accountAddrs.line1Required')
			return
		}
		if (!addr.country.trim()) {
			addressesError = t('accountAddrs.countryRequired')
			return
		}
		addressSubmitting = true
		try {
			if (editingAddress) {
				await account.updateAddress(fetch, editingAddress.id, addr)
			} else {
				await account.createAddress(fetch, addr)
			}
			showAddressForm = false
			editingAddress = null
			await loadAddresses()
		} catch (e) {
			addressesError = e instanceof ApiError ? e.message : t('accountAddrs.failed')
		} finally {
			addressSubmitting = false
		}
	}

	async function deleteAddress(id: string) {
		if (!window.confirm(t('accountAddrs.deleteConfirm'))) return
		try {
			await account.removeAddress(fetch, id)
			await loadAddresses()
		} catch (e) {
			if (account.isAuthError(e)) return
			addressesError = t('account.genericError')
		}
	}

	async function setDefault(id: string, type: 'shipping' | 'billing') {
		try {
			await account.setDefaultAddress(fetch, id, type)
			await loadAddresses()
		} catch (e) {
			if (account.isAuthError(e)) return
			addressesError = t('account.genericError')
		}
	}

	const formatDate = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
</script>

<svelte:head>
	<title>{account.signedIn ? t('account.title') : t('navigation.signIn')} · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-10">
	{#if account.signedIn && account.customer}
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">{t('account.title')}</h1>
				<p class="mt-1 text-sm text-gray-500">
					{t('account.signedInAs', { email: account.customer.email })}
				</p>
			</div>
			<button
				type="button"
				class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
				onclick={() => {
					account.logout()
					orders = []
					ordersLoadedFor = ''
				}}
			>
				{t('navigation.signOut')}
			</button>
		</div>

		{#if account.customer.emailVerified === false}
			<div class="mt-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
				<div class="text-sm text-amber-800">
					<p class="font-medium">{t('accountVerify.bannerTitle')}</p>
					<p class="mt-0.5 text-amber-700">{t('accountVerify.bannerBody')}</p>
				</div>
				<button
					type="button"
					class="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
					onclick={resendVerification}
				>
					{t('accountVerify.resend')}
				</button>
			</div>
			{#if verifyMessage}
				<p class="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{verifyMessage}</p>
			{/if}
		{/if}

		<section class="mt-8">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-gray-900">{t('account.orderHistory')}</h2>
				<button
					type="button"
					class="text-sm font-medium text-indigo-600 hover:text-indigo-700"
					onclick={loadOrders}
				>
					{t('account.refresh')}
				</button>
			</div>

			{#if ordersLoading}
				<p class="mt-4 text-sm text-gray-400">{t('app.loadingOrders')}</p>
			{:else if ordersError}
				<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{ordersError}</p>
			{:else if orders.length === 0}
				<div class="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
					<p class="text-sm text-gray-500">{t('account.noOrders')}</p>
					<a href={`/${slug}/products`} class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
						{t('account.startShopping')}
					</a>
				</div>
			{:else}
				<ul class="mt-4 space-y-3">
					{#each orders as order (order.id)}
						<li>
							<a
								href={`/${slug}/orders/${encodeURIComponent(order.orderNumber)}`}
								class="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm"
							>
								<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
									<span class="font-mono text-sm font-semibold text-gray-900">{order.orderNumber}</span>
									<span
										class="rounded-full px-2 py-0.5 text-xs font-medium
											{order.paymentStatus === 'paid' ? 'bg-green-50 text-green-700' :
												order.paymentStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}"
									>
										{statusLabel(order.paymentStatus)}
									</span>
									<span class="text-xs uppercase tracking-wide text-gray-400">{order.status}</span>
									<span class="ml-auto text-xs text-gray-400">{formatDate(order.createdAt)}</span>
								</div>
								<p class="mt-2 truncate text-sm text-gray-500">
									{order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
								</p>
								<div class="mt-2 flex items-center justify-between">
									<span class="text-xs text-gray-400">{order.itemCount} {t('order.items')}</span>
									<span class="text-sm font-semibold text-gray-900">{money(order.total, order.currency)}</span>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mt-8 max-w-md rounded-2xl border border-gray-200 bg-white p-6">
			<h2 class="text-lg font-semibold text-gray-900">{t('account.password')}</h2>
			<form class="mt-4 space-y-3" onsubmit={changePassword}>
				<div>
					<label class="text-sm font-medium text-gray-700" for="currentPassword">{t('account.currentPassword')}</label>
					<input
						id="currentPassword"
						type="password"
						bind:value={currentPassword}
						autocomplete="current-password"
						required
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>
				<div>
					<label class="text-sm font-medium text-gray-700" for="newPassword">{t('account.newPassword')}</label>
					<input
						id="newPassword"
						type="password"
						bind:value={newPassword}
						placeholder={t('account.passwordMinLengthHint')}
						autocomplete="new-password"
						required
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>
				{#if pwMessage}
					<p
						class="rounded-lg px-4 py-3 text-sm font-medium
							{pwMessage.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}"
					>
						{pwMessage.text}
					</p>
				{/if}
				<button
					type="submit"
					disabled={pwSubmitting}
					class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
				>
					{pwSubmitting ? t('common.loading') : t('account.updatePassword')}
				</button>
			</form>
		</section>

		<section class="mt-8 max-w-md rounded-2xl border border-gray-200 bg-white p-6">
			<h2 class="text-lg font-semibold text-gray-900">{t('accountProfile.title')}</h2>
			<form class="mt-4 space-y-3" onsubmit={saveProfile}>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="text-sm font-medium text-gray-700" for="profFirstName">{t('account.firstName')}</label>
						<input
							id="profFirstName"
							type="text"
							bind:value={profFirstName}
							autocomplete="given-name"
							class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
					<div>
						<label class="text-sm font-medium text-gray-700" for="profLastName">{t('account.lastName')}</label>
						<input
							id="profLastName"
							type="text"
							bind:value={profLastName}
							autocomplete="family-name"
							class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
				</div>
				<div>
					<label class="text-sm font-medium text-gray-700" for="profPhone">{t('accountProfile.phone')}</label>
					<input
						id="profPhone"
						type="tel"
						bind:value={profPhone}
						autocomplete="tel"
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>
				{#if profMessage}
					<p
						class="rounded-lg px-4 py-3 text-sm font-medium
							{profMessage.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}"
					>
						{profMessage.text}
					</p>
				{/if}
				<button
					type="submit"
					disabled={profSubmitting}
					class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
				>
					{profSubmitting ? t('common.loading') : t('accountProfile.save')}
				</button>
			</form>
		</section>

		<section class="mt-8 rounded-2xl border border-gray-200 bg-white p-6">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-gray-900">{t('accountAddrs.title')}</h2>
				<button
					type="button"
					class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
					onclick={() => resetAddressForm(null)}
				>
					{t('accountAddrs.add')}
				</button>
			</div>

			{#if addressesLoading}
				<p class="mt-4 text-sm text-gray-400">{t('common.loading')}</p>
			{:else if addresses.length === 0}
				<p class="mt-4 text-sm text-gray-500">{t('accountAddrs.empty')}</p>
			{:else}
				<ul class="mt-4 space-y-3">
					{#each addresses as a (a.id)}
						<li class="rounded-xl border border-gray-200 bg-white p-4">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 text-sm text-gray-700">
									<div class="flex flex-wrap items-center gap-2 font-medium text-gray-900">
										<span>{fullName(a) || a.label}</span>
										{#if a.isDefaultShipping}<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{t('accountAddrs.defaultShipping')}</span>{/if}
										{#if a.isDefaultBilling}<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{t('accountAddrs.defaultBilling')}</span>{/if}
									</div>
									<p class="mt-1 text-gray-500">{addressLines(a)}</p>
									{#if a.phone}<p class="text-gray-400">{a.phone}</p>{/if}
								</div>
								<div class="flex shrink-0 flex-col items-end gap-2">
									<div class="flex gap-2">
										<button
											type="button"
											class="text-sm font-medium text-indigo-600 hover:text-indigo-700"
											onclick={() => resetAddressForm(a)}
										>
											{t('accountAddrs.edit')}
										</button>
										<button
											type="button"
											class="text-sm font-medium text-red-600 hover:text-red-700"
											onclick={() => deleteAddress(a.id)}
										>
											{t('accountAddrs.delete')}
										</button>
									</div>
									<div class="flex gap-2 text-xs">
										{#if !a.isDefaultShipping}
											<button type="button" class="text-gray-500 hover:text-indigo-600" onclick={() => setDefault(a.id, 'shipping')}>
												{t('accountAddrs.setDefaultShipping')}
											</button>
										{/if}
										{#if !a.isDefaultBilling}
											<button type="button" class="text-gray-500 hover:text-indigo-600" onclick={() => setDefault(a.id, 'billing')}>
												{t('accountAddrs.setDefaultBilling')}
											</button>
										{/if}
									</div>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if addressesError}
				<p class="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{addressesError}</p>
			{/if}

			{#if showAddressForm}
				<div class="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
					<h3 class="text-sm font-semibold text-gray-900">
						{editingAddress ? t('accountAddrs.edit') : t('accountAddrs.add')}
					</h3>
					<form class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" onsubmit={saveAddress}>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrLine1">{t('accountAddrs.line1')}</label>
							<input
								id="addrLine1"
								type="text"
								bind:value={addr.line1}
								required
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrLine2">{t('accountAddrs.line2')}</label>
							<input
								id="addrLine2"
								type="text"
								bind:value={addr.line2}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrName">{t('accountAddrs.name')}</label>
							<input
								id="addrName"
								type="text"
								bind:value={addr.name}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrCompany">{t('accountAddrs.company')}</label>
							<input
								id="addrCompany"
								type="text"
								bind:value={addr.company}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrCity">{t('accountAddrs.city')}</label>
							<input
								id="addrCity"
								type="text"
								bind:value={addr.city}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrState">{t('accountAddrs.state')}</label>
							<input
								id="addrState"
								type="text"
								bind:value={addr.state}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrPostal">{t('accountAddrs.postalCode')}</label>
							<input
								id="addrPostal"
								type="text"
								bind:value={addr.postalCode}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrCountry">{t('accountAddrs.country')}</label>
							<input
								id="addrCountry"
								type="text"
								bind:value={addr.country}
								autoCapitalize="characters"
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrPhone">{t('accountAddrs.phone')}</label>
							<input
								id="addrPhone"
								type="tel"
								bind:value={addr.phone}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="addrType">{t('accountAddrs.type')}</label>
							<select
								id="addrType"
								bind:value={addr.addressType}
								class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							>
								<option value="both">{t('accountAddrs.both')}</option>
								<option value="shipping">{t('accountAddrs.shipping')}</option>
								<option value="billing">{t('accountAddrs.billing')}</option>
							</select>
						</div>
						<div class="flex items-end gap-2 sm:col-span-2">
							<button
								type="submit"
								disabled={addressSubmitting}
								class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
							>
								{addressSubmitting ? t('common.loading') : t('accountAddrs.save')}
							</button>
							<button
								type="button"
								class="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
								onclick={() => {
									showAddressForm = false
									editingAddress = null
								}}
							>
								{t('accountAddrs.cancel')}
							</button>
						</div>
					</form>
				</div>
			{/if}
		</section>
	{:else}
		<div class="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
			<div class="flex rounded-lg bg-gray-100 p-1 text-sm font-medium">
				<button
					type="button"
					class="flex-1 rounded-md px-3 py-2 transition {mode === 'login' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => {
						mode = 'login'
						authError = ''
					}}
				>
					{t('navigation.signIn')}
				</button>
				<button
					type="button"
					class="flex-1 rounded-md px-3 py-2 transition {mode === 'register' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => {
						mode = 'register'
						authError = ''
					}}
				>
					{t('account.createAccount')}
				</button>
			</div>

			<form class="mt-6 space-y-4" onsubmit={submitAuth}>
				{#if mode === 'register'}
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="text-sm font-medium text-gray-700" for="firstName">{t('account.firstName')}</label>
							<input
								id="firstName"
								type="text"
								bind:value={firstName}
								autocomplete="given-name"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="lastName">{t('account.lastName')}</label>
							<input
								id="lastName"
								type="text"
								bind:value={lastName}
								autocomplete="family-name"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
					</div>
				{/if}
				<div>
					<label class="text-sm font-medium text-gray-700" for="accountEmail">{t('account.email')}</label>
					<input
						id="accountEmail"
						type="email"
						bind:value={email}
						placeholder="you@example.com"
						autocomplete="email"
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>
				<div>
					<label class="text-sm font-medium text-gray-700" for="accountPassword">{t('account.password')}</label>
					<input
						id="accountPassword"
						type="password"
						bind:value={password}
						placeholder={mode === 'register' ? t('account.passwordMinLengthHint') : t('account.yourPassword')}
						autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>

				{#if mode === 'register'}
					<div>
						<label class="text-sm font-medium text-gray-700" for="claimOrderNumber">
							{t('account.recentOrderNumber')} <span class="font-normal text-gray-400">{t('account.guestOnly')}</span>
						</label>
						<input
							id="claimOrderNumber"
							type="text"
							bind:value={claimOrderNumber}
							placeholder="e.g. #WABC123XYZ"
							class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
				{/if}

				{#if authError}
					<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{authError}</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
				>
					{submitting ? t('common.loading') : mode === 'login' ? t('navigation.signIn') : t('account.createAccount')}
				</button>
				{#if mode === 'login'}
					<a href={`/${slug}/account/forgot`} class="block text-center text-sm font-medium text-indigo-600 hover:text-indigo-700">
						{t('account.forgot.title')}
					</a>
				{/if}
				{#if mode === 'register'}
					<p class="text-center text-xs text-gray-400">
						{t('account.linkPastOrders')}
					</p>
				{/if}
			</form>
		</div>
	{/if}
</div>
