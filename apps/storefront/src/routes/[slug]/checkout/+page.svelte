<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { onMount } from 'svelte'
	import { ApiError, storefrontApi } from '$lib/api'
	import { cart } from '$lib/cart.svelte'
	import { account } from '$lib/account.svelte'
	import { money, placeholderImage, handleImageError } from '$lib/format'
	import { t } from '$lib/i18n'
	import { track } from '$lib/analytics'
	import type { CheckoutField, CheckoutSummary, ShopperAddress } from '$lib/types'

	/** Affiliate code persisted by the store layout from ?ref= (30-day window). */
	const readReferralCode = (): string | undefined => {
		try {
			const raw = localStorage.getItem('ecom:ref')
			if (!raw) return undefined
			const parsed = JSON.parse(raw) as { code?: string; at?: number }
			if (!parsed.code || Date.now() - (parsed.at ?? 0) > 30 * 24 * 60 * 60 * 1000) return undefined
			return parsed.code
		} catch {
			return undefined
		}
	}
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

	// Saved address book (signed-in shoppers only — guests keep manual entry).
	let savedAddresses = $state<ShopperAddress[]>([])
	let selectedAddressId = $state('')
	let addressesLoading = $state(false)
	let addressPrefilled = $state(false)

	// Idempotency key for this checkout attempt — regenerated per page load so a
	// timeout/retry of the same attempt can never double-order on the server.
	const checkoutAttemptId = crypto.randomUUID()

	const countries = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'US', 'GB', 'DE', 'FR']

	// Countries this merchant actually sells to: explicit shipping-zone lists
	// win, then the merchant home country (delivery restriction), then a broad
	// fallback for fully-unrestricted stores.
	const merchantCountry = $derived(store.merchant.country ?? '')
	const zoneCountries = $derived(
		Array.from(new Set(store.shipping.zones.flatMap((z) => z.countries ?? []).filter(Boolean)))
	)
	const allowedCountries = $derived.by(() => {
		if (zoneCountries.length > 0) {
			return Array.from(new Set(merchantCountry ? [merchantCountry, ...zoneCountries] : zoneCountries))
		}
		if (merchantCountry) return [merchantCountry]
		return countries
	})

	const requiredFields = $derived(store.checkout.requiredFields)
	const fieldRequired = (field: CheckoutField) => requiredFields[field] === true
	const requiredMark = (field: CheckoutField) => (fieldRequired(field) ? ' *' : '')

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

	$effect(() => {
		if (!allowedCountries.length) return
		if (!allowedCountries.includes(country)) {
			country = allowedCountries[0]
		}
	})

	const selectedIsProvider = $derived(onlineProviders.some((p) => p.id === paymentMethod))

	const lineOptions = (options: Record<string, string>) =>
		Object.entries(options).map(([k, v]) => `${k}: ${v}`).join(' · ')

	const buildPreviewBody = () => ({
		items: cart.items.map((i) => ({
			productId: i.productId,
			variantId: i.variantId,
			quantity: i.quantity,
			selections: i.selections
		})),
		couponCode: couponCode.trim() || undefined,
		// Preview accepts city/state/postal/country so the quoted shipping
		// matches pin/city-level rules, not just the country.
		shippingAddress: {
			country,
			state: region.trim() || undefined,
			city: city.trim() || undefined,
			postalCode: postalCode.trim() || undefined
		}
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
			previewError = e instanceof ApiError ? e.message : t('checkout.validateCart')
		}
	}

	$effect(() => {
		const count = cart.count
		if (count > 0 && !previewed) {
			refreshPreview()
		}
	})

	// Shipping zones/tax rules can differ per destination — keep the quote in sync.
	let lastPreviewKey = $state('')
	$effect(() => {
		const current = [country, region.trim(), city.trim(), postalCode.trim()].join('|')
		if (lastPreviewKey && current !== lastPreviewKey && previewed) {
			refreshPreview()
		}
		lastPreviewKey = current
	})

	const applyAddress = (a: ShopperAddress | null) => {
		if (!a) return
		if (a.name) shippingName = a.name
		line1 = a.line1
		line2 = a.line2 ?? ''
		city = a.city ?? ''
		region = a.state ?? ''
		postalCode = a.postalCode ?? ''
		if (a.country && allowedCountries.includes(a.country)) country = a.country
		if (a.phone) phone = a.phone
		if (previewed) refreshPreview()
	}

	const onAddressSelect = (id: string) => {
		selectedAddressId = id
		applyAddress(savedAddresses.find((a) => a.id === id) ?? null)
	}

	$effect(() => {
		if (!account.signedIn || addressesLoading || addressPrefilled) return
		addressesLoading = true
		account
			.addresses(fetch)
			.then((list) => {
				savedAddresses = list
				const preferred =
					list.find((a) => a.isDefaultShipping) ??
					list.find((a) => a.addressType === 'shipping' || a.addressType === 'both') ??
					list[0]
				if (preferred) {
					selectedAddressId = preferred.id
					applyAddress(preferred)
				}
				addressPrefilled = true
			})
			.catch(() => {
				// Manual entry keeps working when the address book is unavailable.
			})
			.finally(() => {
				addressesLoading = false
			})
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
			couponError = e instanceof ApiError ? e.message : t('checkout.invalidCoupon')
		}
	}

	const removeCoupon = async () => {
		couponCode = ''
		couponError = ''
		await refreshPreview()
	}

	const validate = () => {
		const required: Array<[CheckoutField, string, string]> = [
			['email', email, t('checkout.email')],
			['phone', phone, t('checkout.phone')],
			['name', shippingName, t('checkout.fullName')],
			['line1', line1, t('checkout.addressLine1')],
			['line2', line2, t('checkout.addressLine2')],
			['city', city, t('checkout.city')],
			['state', region, t('checkout.state')],
			['postalCode', postalCode, t('checkout.postalCode')],
			['country', country, t('checkout.country')]
		]
		for (const [field, value, label] of required) {
			if (fieldRequired(field) && !value.trim()) {
				orderError = t('checkout.requiredField', { label })
				return false
			}
		}
		// Email format is only enforced when a value was provided — the merchant
		// controls whether the field itself is mandatory via requiredFields.
		if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
			orderError = t('checkout.invalidEmail')
			return false
		}
		if (!paymentMethod) {
			orderError = t('checkout.selectPayment')
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
			// Prefer an explicitly-marked billing address for the invoice copy;
			// otherwise the API falls back to the shipping address.
			const billingSrc =
				savedAddresses.find((a) => a.isDefaultBilling) ??
				savedAddresses.find((a) => a.addressType === 'billing')
			const payload = {
				items: cart.items.map((i) => ({
					productId: i.productId,
					variantId: i.variantId,
					quantity: i.quantity,
					selections: i.selections
				})),
				couponCode: couponCode.trim() || undefined,
				email: email.trim(),
				referralCode: readReferralCode(),
shippingAddress: {
				name: shippingName.trim(),
				line1: line1.trim(),
				line2: line2.trim() || undefined,
				city: city.trim(),
				state: region.trim(),
				postalCode: postalCode.trim(),
				country,
				phone: phone.trim() || undefined,
				// Delivered inside the address so the server-side required-field
				// check can enforce email when the merchant enables it.
				email: email.trim() || undefined
			},
				billingAddress: billingSrc
					? {
							name: billingSrc.name ?? undefined,
							line1: billingSrc.line1,
							line2: billingSrc.line2 ?? undefined,
							city: billingSrc.city ?? undefined,
							state: billingSrc.state ?? undefined,
							postalCode: billingSrc.postalCode ?? undefined,
							country: billingSrc.country,
							phone: billingSrc.phone ?? undefined
						}
					: undefined,
				paymentMethod,
				notes: notes.trim() || undefined,
				cartId: cart.persistedCartId,
				// Same key per attempt: a network retry reuses the original order
				// instead of creating a second one.
				idempotencyKey: checkoutAttemptId
			}

			if (selectedIsProvider) {
				const session = await storefrontApi.checkoutPay(fetch, slug, payload)
				sessionStorage.setItem(`ecom:pending:${slug}`, session.orderNumber)
				// A provider replay (same key already placed) returns the stored
				// order without a redirect — go straight to the confirmation page.
				if (!session.requiresRedirect) {
					cart.clear()
					await goto(`/${slug}/orders/${encodeURIComponent(session.orderNumber)}`)
					return
				}
				// Defense in depth: only ever redirect to an https gateway URL.
				if (!/^https:\/\//i.test(session.redirectUrl)) {
					orderError = t('checkout.invalidRedirect')
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
			orderError = e instanceof ApiError ? e.message : t('checkout.placeFailed')
			await refreshPreview()
		} finally {
			placing = false
		}
	}
</script>

<svelte:head>
	<title>{t('checkout.title')} · {store.settings.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10">
	<h1 class="text-3xl font-bold text-neutral-900">{t('checkout.title')}</h1>

	{#if cart.items.length === 0}
		<div class="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-6 py-16 text-center">
			<p class="text-lg font-medium text-neutral-700">{t('cart.empty')}</p>
			<a
				href={`/${slug}/products`}
				class="rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
			>
				{t('wishlist.browseProducts')}
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

				<section class="rounded-2xl border border-neutral-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-neutral-900">{t('checkout.contact')}</h2>
					{#if account.signedIn && account.customer}
						<p class="mt-1 text-xs text-neutral-400">
							{t('checkout.orderingAs', { email: account.customer.email })} ·
							<a href={`/${slug}/account`} class="font-medium text-brand-600 hover:text-brand-700">{t('checkout.account')}</a>
						</p>
					{/if}
					<div class="mt-4">
						<label class="text-sm font-medium text-neutral-700" for="email">{t('checkout.email')}{requiredMark('email')}</label>
						<input
							id="email"
							type="email"
							bind:value={email}
							placeholder="you@example.com"
							class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
						/>
					</div>
				</section>

				<section class="rounded-2xl border border-neutral-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-neutral-900">{t('checkout.address')}</h2>
					{#if account.signedIn && (savedAddresses.length > 0 || addressesLoading)}
						<div class="mt-4">
							<label class="text-sm font-medium text-neutral-700" for="savedAddress">{t('accountAddrs.title')}</label>
							<select
								id="savedAddress"
								value={selectedAddressId}
								onchange={(e) => onAddressSelect(e.currentTarget.value)}
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							>
								<option value="">{t('accountAddrs.selectManual')}</option>
								{#each savedAddresses as a (a.id)}
									<option value={a.id}>
										{a.label}{a.name ? ` · ${a.name}` : ''} · {[a.line1, a.city, a.country].filter(Boolean).join(', ')}
									</option>
								{/each}
							</select>
						</div>
					{/if}
					<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-neutral-700" for="shippingName">{t('checkout.fullName')}{requiredMark('name')}</label>
							<input
								id="shippingName"
								type="text"
								bind:value={shippingName}
								placeholder="Jane Doe"
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-neutral-700" for="line1">{t('checkout.addressLine1')}{requiredMark('line1')}</label>
							<input
								id="line1"
								type="text"
								bind:value={line1}
								placeholder="Street and number"
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-neutral-700" for="line2">{t('checkout.addressLine2')}{requiredMark('line2')}</label>
							<input
								id="line2"
								type="text"
								bind:value={line2}
								placeholder={t('checkout.addressLine2')}
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-neutral-700" for="city">{t('checkout.city')}{requiredMark('city')}</label>
							<input
								id="city"
								type="text"
								bind:value={city}
								placeholder={t('checkout.city')}
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-neutral-700" for="state">{t('checkout.state')}{requiredMark('state')}</label>
							<input
								id="state"
								type="text"
								bind:value={region}
								placeholder={t('checkout.state')}
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-neutral-700" for="postalCode">{t('checkout.postalCode')}{requiredMark('postalCode')}</label>
							<input
								id="postalCode"
								type="text"
								bind:value={postalCode}
								placeholder={t('checkout.postalCode')}
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
						<div>
							<label class="text-sm font-medium text-neutral-700" for="country">{t('checkout.country')}{requiredMark('country')}</label>
							<select
								id="country"
								bind:value={country}
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							>
								{#each allowedCountries as c (c)}
									<option value={c}>{c}</option>
								{/each}
							</select>
						</div>
						<div class="sm:col-span-2">
							<label class="text-sm font-medium text-neutral-700" for="phone">{t('checkout.phone')}{requiredMark('phone')}</label>
							<input
								id="phone"
								type="tel"
								bind:value={phone}
								placeholder="+1 555 000 0000"
								class="mt-1 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
							/>
						</div>
					</div>
				</section>

				<section class="rounded-2xl border border-neutral-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-neutral-900">{t('checkout.paymentMethod')}</h2>
					<div class="mt-4 space-y-3">
						{#each onlineProviders as provider (provider.id)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded-lg border p-4
									{paymentMethod === provider.id ? 'border-brand-600 bg-brand-50' : 'border-neutral-200 hover:border-neutral-300'}"
							>
								<input
									type="radio"
									name="paymentMethod"
									value={provider.id}
									bind:group={paymentMethod}
									class="accent-brand-600"
								/>
								<span class="text-sm font-medium text-neutral-800">{provider.label}</span>
								<span class="ml-auto text-xs text-neutral-400">{t('checkout.secure')}</span>
							</label>
						{/each}
						{#if onlineProviders.length > 0 && paymentMethods.length > 0}
							<p class="pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
								{t('checkout.payOnDelivery')}
							</p>
						{/if}
						{#each paymentMethods as method (method.id)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded-lg border p-4
									{paymentMethod === method.id ? 'border-brand-600 bg-brand-50' : 'border-neutral-200 hover:border-neutral-300'}"
							>
								<input
									type="radio"
									name="paymentMethod"
									value={method.id}
									bind:group={paymentMethod}
									class="accent-brand-600"
								/>
								<span class="text-sm font-medium text-neutral-800">{method.label}</span>
							</label>
						{/each}
					</div>
				</section>

				<section class="rounded-2xl border border-neutral-200 bg-white p-6">
					<h2 class="text-lg font-semibold text-neutral-900">{t('checkout.notes')}</h2>
					<textarea
						bind:value={notes}
						rows="2"
						placeholder={t('checkout.notesPlaceholder')}
						class="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
					></textarea>
				</section>
			</div>

			<aside class="h-fit rounded-2xl border border-neutral-200 bg-white p-6 lg:sticky lg:top-24 lg:col-span-2">
				<h2 class="text-lg font-semibold text-neutral-900">{t('cart.summary')}</h2>

				<ul class="mt-4 space-y-4">
					{#each cart.items as line (line.variantId)}
						<li class="flex items-center gap-3">
							<div class="relative">
								<img
									src={line.image ?? placeholderImage()}
									alt={line.name}
									class="h-14 w-14 rounded-lg border border-neutral-200 object-cover"
									onerror={handleImageError}
								/>
								<span
									class="absolute -end-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-bold text-white"
								>
									{line.quantity}
								</span>
							</div>
							<div class="flex-1">
								<p class="text-sm font-medium text-neutral-900">{line.name}</p>
								{#if lineOptions(line.optionValues)}
									<p class="text-xs text-neutral-500">{lineOptions(line.optionValues)}</p>
								{/if}
							</div>
							<p class="text-sm font-medium text-neutral-900">
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
							placeholder={t('checkout.couponCode')}
							class="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brand-500"
						/>
						{#if summary?.coupon}
							<button
								type="button"
								class="rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
								onclick={removeCoupon}
							>
								{t('cart.remove')}
							</button>
						{:else}
							<button
								type="button"
								class="rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-800"
								onclick={applyCoupon}
							>
								{t('products.apply')}
							</button>
						{/if}
					</div>
					{#if summary?.coupon}
						<p class="mt-2 text-xs font-medium text-green-700">
							{summary.coupon.code} {t('checkout.applied', { amount: money(summary.discountTotal, store.merchant.currency) })}
						</p>
					{/if}
				</div>

				<dl class="mt-6 space-y-2 border-t border-neutral-200 pt-4 text-sm">
					<div class="flex justify-between text-neutral-600">
						<dt>{t('order.subtotal')}</dt>
						<dd class="font-medium text-neutral-900">{money(summary?.subtotal ?? cart.subtotal, store.merchant.currency)}</dd>
					</div>
					{#if summary && summary.discountTotal > 0}
						<div class="flex justify-between text-neutral-600">
							<dt>{t('order.discount')}</dt>
							<dd class="font-medium text-green-700">−{money(summary.discountTotal, store.merchant.currency)}</dd>
						</div>
					{/if}
					<div class="flex justify-between text-neutral-600">
						<dt>{t('order.shipping')}</dt>
						<dd class="font-medium text-neutral-900">
							{#if summary}
								{summary.shippingTotal === 0 ? t('order.free') : money(summary.shippingTotal, store.merchant.currency)}
							{:else}
								<span class="text-neutral-400">{t('checkout.calculatedAtCheckout')}</span>
							{/if}
						</dd>
					</div>
					<div class="flex justify-between text-neutral-600">
						<dt>{t('order.tax')}</dt>
						<dd class="font-medium text-neutral-900">
							{#if summary}
								{money(summary.taxTotal, store.merchant.currency)}
							{:else}
								<span class="text-neutral-400">{t('checkout.calculatedAtCheckout')}</span>
							{/if}
						</dd>
					</div>
					<div class="flex justify-between border-t border-neutral-200 pt-3 text-base font-semibold text-neutral-900">
						<dt>{t('order.total')}</dt>
						<dd>{money(summary?.total ?? cart.subtotal, store.merchant.currency)}</dd>
					</div>
				</dl>

				{#if orderError}
					<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{orderError}</p>
				{/if}

				<button
					type="button"
					class="mt-6 w-full rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
					disabled={placing}
					onclick={placeOrder}
				>
					{placing ? t('common.loading') : selectedIsProvider ? t('checkout.payWith', { provider: onlineProviders.find((p) => p.id === paymentMethod)?.label ?? t('checkout.provider') }) : t('checkout.placeOrder')}
				</button>
				{#if !selectedIsProvider}
					<p class="mt-3 text-center text-xs text-neutral-400">
						{t('checkout.codNote')}
					</p>
				{:else}
					<p class="mt-3 text-center text-xs text-neutral-400">
						{t('checkout.redirectNote')}
					</p>
				{/if}
			</aside>
		</div>
	{/if}
</div>
