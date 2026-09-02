<script lang="ts">
	import { ApiError } from '$lib/api'
	import { account } from '$lib/account.svelte'
	import { money } from '$lib/format'
	import { t } from '$lib/i18n'
	import type { ShopperOrderSummary } from '$lib/types'
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

	let orders = $state<ShopperOrderSummary[]>([])
	let ordersError = $state('')
	let ordersLoading = $state(false)
	let ordersLoadedFor = $state('')

	$effect(() => {
		if (account.signedIn && ordersLoadedFor !== account.customer?.id) {
			loadOrders()
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
				{#if mode === 'register'}
					<p class="text-center text-xs text-gray-400">
						{t('account.linkPastOrders')}
					</p>
				{/if}
			</form>
		</div>
	{/if}
</div>
