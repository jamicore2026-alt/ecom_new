<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { onMount } from 'svelte'
	import { ApiError, storefrontApi } from '$lib/api'
	import { cart } from '$lib/cart.svelte'
	import { account } from '$lib/account.svelte'
	import { money, placeholderImage } from '$lib/format'
	import { track } from '$lib/analytics'
	import type { CheckoutSummary } from '$lib/types'
	import type { PageProps } from './$types'

	let { data }: PageProps = $props()
	const store = $derived(data.store)
	const slug = $derived(data.slug)

	$effect(() => {
		track(slug, 'checkout_start')
		account.setSlug(slug)
		cart.setSlug(slug)
	})

	// Restore an abandoned cart via a ?recovery=<code> link, then drop the param.
	onMount(async () => {
		const code = page.url.searchParams.get('recovery')
		if (!code || !slug) return
		try {
			const recovered = await storefrontApi.recoverCart(fetch, slug, code)
			cart.restore(recovered.items, recovered.cartId)
			const url = new URL(window.location.href)
			url.searchParams.delete('recovery')
			window.history.replaceState({}, '', url.toString())
		} catch {
			// Ignore — fall back to normal empty-cart checkout experience.
		}
	})

	const paymentMethods = $derived(
		store.payments.methods.filter((m) => m.enabled)
	)
	const onlineProviders = $derived(store.payments.providers ?? [])

	let email = $state('')
	let shippingName = $state('')
	let line1 = $state('')
	let line2 = $state('')
	let city = $state('')
	let region = $state('')
	let postalCode = $state('')
	let country = $state('SA')
	let phone = $state('')
	let paymentMethod = $state('')
	let couponCode = $state('')
	let notes = $state('')

	let summary = $state<CheckoutSummary | null>(null)
	let previewError = $state('')
	let couponError = $state('')
	let orderError = $state('')
	let placing = $state(false)
	let previewed = $state(false)

	const countries = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'US', 'GB', 'DE', 'FR']

	$effect(() => {
		if (!paymentMethod) {
			paymentMethod = onlineProviders[0]?.id ?? paymentMethods[0]?.id ?? ''
		}
	})

	$effect(() => {
		const customer = account.customer
		if (!customer) return
		if (!email.trim()) email = customer.email
		const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()
		if (!shippingName.trim() && fullName) shippingName = fullName
		if (!phone.trim() && customer.phone) phone = customer.phone
	})

	const selectedIsProvider = $derived(onlineProviders.some((p) => p.id === paymentMethod))

	const lineOptions = (options: Record<string, string>) =>
		Object.entries(options).map(([k, v]) => `${k}: ${v}`).join(' · ')

	const buildPreviewBody = () => ({
		items: cart.items.map((i) => ({
			productId: i.productId,
			variantId: i.variantId,
			quantity: i.quantity
		})),
		couponCode: couponCode.trim() || undefined,
		shippingAddress: { country }
	})

	const refreshPreview = async () => {
		if (!cart.items.length) return
		previewError = ''
		try {
			summary = await storefrontApi.checkoutPreview(fetch, slug, buildPreviewBody())
			previewed = true
		} catch (e) {
			summary = null
			previewed = false
			previewError = e instanceof ApiError ? e.message : 'Could not validate your cart'
		}
	}

	$effect(() => {
		const count = cart.count
		if (count > 0 && !previewed) {
			refreshPreview()
		}
	})

	// Shipping zones/tax rules can differ per country — keep the quote in sync.
	let lastPreviewCountry = $state('')
	$effect(() => {
		const current = country
		if (lastPreviewCountry && current !== lastPreviewCountry && previewed) {
			refreshPreview()
		}
		lastPreviewCountry = current
	})

	const applyCoupon = async () => {
		couponError = ''
		if (!couponCode.trim()) {
			couponCode = ''
			await refreshPreview()
			return
		}
		try {
			const result = await storefrontApi.checkoutPreview(fetch, slug, buildPreviewBody())
			summary = result
			previewed = true
		} catch (e) {
			summary = null
			previewed = false
			couponError = e instanceof ApiError ? e.message : 'Invalid coupon'
		}
	}

	const removeCoupon = async () => {
		couponCode = ''
		couponError = ''
		await refreshPreview()
	}

	const validate = () => {
		const required: Array<[string, string]> = [
			[email, 'Email'],
			[shippingName, 'Full name'],
			[line1, 'Address line 1'],
			[city, 'City'],
			[region, 'State / Province'],
			[postalCode, 'Postal code']
		]
		for (const [value, label] of required) {
			if (!value.trim()) {
				orderError = `${label} is required`
				return false
			}
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
			orderError = 'Enter a valid email address'
			return false
		}
		if (!paymentMethod) {
			orderError = 'Select a payment method'
			return false
		}
		return true
	}

	const placeOrder = async () => {
		orderError = ''
		if (!validate()) return
		if (!previewed || !summary) {
			await refreshPreview()
			if (!summary) return
		}
		placing = true
		try {
			const payload = {
				items: cart.items.map((i) => ({
					productId: i.productId,
					variantId: i.variantId,
					quantity: i.quantity
				})),
				couponCode: couponCode.trim() || undefined,
				email: email.trim(),
				shippingAddress: {
					name: shippingName.trim(),
					line1: line1.trim(),
					line2: line2.trim() || undefined,
					city: city.trim(),
					state: region.trim(),
					postalCode: postalCode.trim(),
					country,
					phone: phone.trim() || undefined
				},
				paymentMethod,
				notes: notes.trim() || undefined,
				cartId: cart.persistedCartId
			}

			if (selectedIsProvider) {
				const session = await storefrontApi.checkoutPay(fetch, slug, payload)
				sessionStorage.setItem(`ecom:pending:${slug}`, session.orderNumber)
				// Defense in depth: only ever redirect to an https gateway URL.
				if (!/^https:\/\//i.test(session.redirectUrl)) {
					orderError = 'Payment provider returned an invalid redirect — please contact support'
					await refreshPreview()
					return
				}
				window.location.href = session.redirectUrl
				return
			}

			const order = await storefrontApi.checkout(fetch, slug, payload)
			cart.clear()
			await goto(`/${slug}/orders/${encodeURIComponent(order.orderNumber)}`)
		} catch (e) {
			orderError = e instanceof ApiError ? e.message : 'Something went wrong placing your order'
			await refreshPreview()
		} finally {
			placing = false
		}
	}
</script>

<svelte:head>
	<title>Checkout · {store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10">
	<h1 class="text-3xl font-bold text-gray-900">Checkout</h1>

	{#if cart.items.length === 0}
		<div class="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
			<p class="text-lg font-medium text-gray-700">Your cart is empty</p>
			<a
				href={`/${slug}/products`}
				class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				Browse products
			</a>
		</div>
	{:else}
		<div class="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-5">
			<div class="flex flex-col gap-6 lg:col-span-3">
				{#if previewError || couponError}
					<p class="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
						{previewError || couponError}
					</p>
				{/if}

				<section class="rounded-2xl border border-gray-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-gray-900">Contact</h2>
					{#if account.signedIn && account.customer}
						<p class="mt-1 text-xs text-gray-400">
							Ordering as {account.customer.email} ·
							<a href={`/${slug}/account`} class="font-medium text-indigo-600 hover:text-indigo-700">Your account</a>
						</p>
					{/if}
					<div class="mt-4">
						<label class="text-sm font-medium text-gray-700" for="email">Email</label>
						<input
							id="email"
							type="email"
							bind:value={email}
							placeholder="you@example.com"
							class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
				</section>

				<section class="rounded-2xl border border-gray-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-gray-900">Shipping address</h2>
					<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-gray-700" for="shippingName">Full name</label>
							<input
								id="shippingName"
								type="text"
								bind:value={shippingName}
								placeholder="Jane Doe"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-gray-700" for="line1">Address</label>
							<input
								id="line1"
								type="text"
								bind:value={line1}
								placeholder="Street and number"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div class="sm:col-span-2">
							<input
								type="text"
								bind:value={line2}
								placeholder="Apartment, suite, etc. (optional)"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="city">City</label>
							<input
								id="city"
								type="text"
								bind:value={city}
								placeholder="City"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="state">State / Province</label>
							<input
								id="state"
								type="text"
								bind:value={region}
								placeholder="State"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="postalCode">Postal code</label>
							<input
								id="postalCode"
								type="text"
								bind:value={postalCode}
								placeholder="Postal code"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-gray-700" for="country">Country</label>
							<select
								id="country"
								bind:value={country}
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							>
								{#each countries as c (c)}
									<option value={c}>{c}</option>
								{/each}
							</select>
						</div>
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-gray-700" for="phone">Phone (optional)</label>
							<input
								id="phone"
								type="tel"
								bind:value={phone}
								placeholder="+1 555 000 0000"
								class="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
					</div>
				</section>

				<section class="rounded-2xl border border-gray-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-gray-900">Payment method</h2>
					<div class="mt-4 space-y-3">
						{#each onlineProviders as provider (provider.id)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded-lg border p-4
									{paymentMethod === provider.id ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}"
							>
								<input
									type="radio"
									name="paymentMethod"
									value={provider.id}
									bind:group={paymentMethod}
									class="accent-indigo-600"
								/>
								<span class="text-sm font-medium text-gray-800">{provider.label}</span>
								<span class="ml-auto text-xs text-gray-400">Secure checkout</span>
							</label>
						{/each}
						{#if onlineProviders.length > 0 && paymentMethods.length > 0}
							<p class="pt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
								Pay on delivery
							</p>
						{/if}
						{#each paymentMethods as method (method.id)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded-lg border p-4
									{paymentMethod === method.id ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}"
							>
								<input
									type="radio"
									name="paymentMethod"
									value={method.id}
									bind:group={paymentMethod}
									class="accent-indigo-600"
								/>
								<span class="text-sm font-medium text-gray-800">{method.label}</span>
							</label>
						{/each}
					</div>
				</section>

				<section class="rounded-2xl border border-gray-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-gray-900">Order notes (optional)</h2>
					<textarea
						bind:value={notes}
						rows="2"
						placeholder="Delivery instructions, gift message, etc."
						class="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
					></textarea>
				</section>
			</div>

			<aside class="h-fit rounded-2xl border border-gray-200 bg-white p-6 lg:sticky lg:top-24 lg:col-span-2">
				<h2 class="text-lg font-semibold text-gray-900">Order summary</h2>

				<ul class="mt-4 space-y-4">
					{#each cart.items as line (line.variantId)}
						<li class="flex items-center gap-3">
							<div class="relative">
								<img
									src={line.image ?? placeholderImage()}
									alt={line.name}
									class="h-14 w-14 rounded-lg border border-gray-200 object-cover"
								/>
								<span
									class="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1 text-[10px] font-bold text-white"
								>
									{line.quantity}
								</span>
							</div>
							<div class="flex-1">
								<p class="text-sm font-medium text-gray-900">{line.name}</p>
								{#if lineOptions(line.optionValues)}
									<p class="text-xs text-gray-500">{lineOptions(line.optionValues)}</p>
								{/if}
							</div>
							<p class="text-sm font-medium text-gray-900">
								{money(line.price * line.quantity, store.merchant.currency)}
							</p>
						</li>
					{/each}
				</ul>

				<div class="mt-4">
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={couponCode}
							placeholder="Coupon code"
							class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
						{#if summary?.coupon}
							<button
								type="button"
								class="rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-600 hover:bg-gray-50"
								onclick={removeCoupon}
							>
								Remove
							</button>
						{:else}
							<button
								type="button"
								class="rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800"
								onclick={applyCoupon}
							>
								Apply
							</button>
						{/if}
					</div>
					{#if summary?.coupon}
						<p class="mt-2 text-xs font-medium text-green-700">
							{summary.coupon.code} applied ({money(summary.discountTotal, store.merchant.currency)} off)
						</p>
					{/if}
				</div>

				<dl class="mt-6 space-y-2 border-t border-gray-200 pt-4 text-sm">
					<div class="flex justify-between text-gray-600">
						<dt>Subtotal</dt>
						<dd class="font-medium text-gray-900">{money(summary?.subtotal ?? cart.subtotal, store.merchant.currency)}</dd>
					</div>
					{#if summary && summary.discountTotal > 0}
						<div class="flex justify-between text-gray-600">
							<dt>Discount</dt>
							<dd class="font-medium text-green-700">−{money(summary.discountTotal, store.merchant.currency)}</dd>
						</div>
					{/if}
					<div class="flex justify-between text-gray-600">
						<dt>Shipping</dt>
						<dd class="font-medium text-gray-900">
							{#if summary}
								{summary.shippingTotal === 0 ? 'Free' : money(summary.shippingTotal, store.merchant.currency)}
							{:else}
								<span class="text-gray-400">Calculated at checkout</span>
							{/if}
						</dd>
					</div>
					<div class="flex justify-between text-gray-600">
						<dt>Tax</dt>
						<dd class="font-medium text-gray-900">
							{#if summary}
								{money(summary.taxTotal, store.merchant.currency)}
							{:else}
								<span class="text-gray-400">Calculated at checkout</span>
							{/if}
						</dd>
					</div>
					<div class="flex justify-between border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
						<dt>Total</dt>
						<dd>{money(summary?.total ?? cart.subtotal, store.merchant.currency)}</dd>
					</div>
				</dl>

				{#if orderError}
					<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{orderError}</p>
				{/if}

				<button
					type="button"
					class="mt-6 w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
					disabled={placing}
					onclick={placeOrder}
				>
					{placing ? 'Placing order…' : selectedIsProvider ? `Pay with ${onlineProviders.find((p) => p.id === paymentMethod)?.label ?? 'provider'}` : 'Place order'}
				</button>
				{#if !selectedIsProvider}
					<p class="mt-3 text-center text-xs text-gray-400">
						Payment is collected on delivery or per the store's instructions.
					</p>
				{:else}
					<p class="mt-3 text-center text-xs text-gray-400">
						You will be redirected to a secure payment page.
					</p>
				{/if}
			</aside>
		</div>
	{/if}
</div>
