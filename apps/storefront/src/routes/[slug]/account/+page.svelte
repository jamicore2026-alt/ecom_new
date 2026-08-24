<script lang="ts">
	import { ApiError } from '$lib/api'
	import { account } from '$lib/account.svelte'
	import { money } from '$lib/format'
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
	let authError = $state('')
	let submitting = $state(false)

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
			ordersError = e instanceof ApiError ? e.message : 'Could not load your orders'
		} finally {
			ordersLoading = false
		}
	}

	const submitAuth = async (event: SubmitEvent) => {
		event.preventDefault()
		authError = ''
		if (!email.trim() || !password) {
			authError = 'Email and password are required'
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
					lastName: lastName.trim() || undefined
				})
			}
			password = ''
			ordersLoadedFor = ''
		} catch (e) {
			authError = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'
		} finally {
			submitting = false
		}
	}

	const statusLabel = (status: string) =>
		status === 'paid' ? 'Paid' : status === 'failed' ? 'Failed' : status === 'refunded' ? 'Refunded' : status

	const formatDate = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
</script>

<svelte:head>
	<title>{account.signedIn ? 'My account' : 'Sign in'} · {data.store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-10">
	{#if account.signedIn && account.customer}
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">My account</h1>
				<p class="mt-1 text-sm text-gray-500">
					Signed in as {account.customer.email}
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
				Sign out
			</button>
		</div>

		<section class="mt-8">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-gray-900">Order history</h2>
				<button
					type="button"
					class="text-sm font-medium text-indigo-600 hover:text-indigo-700"
					onclick={loadOrders}
				>
					Refresh
				</button>
			</div>

			{#if ordersLoading}
				<p class="mt-4 text-sm text-gray-400">Loading orders…</p>
			{:else if ordersError}
				<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{ordersError}</p>
			{:else if orders.length === 0}
				<div class="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
					<p class="text-sm text-gray-500">You haven't placed any orders yet.</p>
					<a href={`/${slug}/products`} class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
						Start shopping
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
									<span class="text-xs text-gray-400">{order.itemCount} item{order.itemCount === 1 ? '' : 's'}</span>
									<span class="text-sm font-semibold text-gray-900">{money(order.total, order.currency)}</span>
								</div>
							</a>
						</li>
					{/each}
				</ul>
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
					Sign in
				</button>
				<button
					type="button"
					class="flex-1 rounded-md px-3 py-2 transition {mode === 'register' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => {
						mode = 'register'
						authError = ''
					}}
				>
					Create account
				</button>
			</div>

			<form class="mt-6 space-y-4" onsubmit={submitAuth}>
				{#if mode === 'register'}
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="text-sm font-medium text-gray-700" for="firstName">First name</label>
							<input
								id="firstName"
								type="text"
								bind:value={firstName}
								autocomplete="given-name"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="lastName">Last name</label>
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
					<label class="text-sm font-medium text-gray-700" for="accountEmail">Email</label>
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
					<label class="text-sm font-medium text-gray-700" for="accountPassword">Password</label>
					<input
						id="accountPassword"
						type="password"
						bind:value={password}
						placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
						autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
						class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>

				{#if authError}
					<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{authError}</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
				>
					{submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
				</button>
				{#if mode === 'register'}
					<p class="text-center text-xs text-gray-400">
						Ordered before? Creating an account with the same email links your past orders.
					</p>
				{/if}
			</form>
		</div>
	{/if}
</div>
