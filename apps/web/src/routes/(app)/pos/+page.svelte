<script lang="ts">
	import { onMount } from 'svelte'
	import { api, ApiError, getSelectedOutletId } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { currency } from '$lib/format'
	import { t } from '$lib/i18n'
	import type { FoodOrder, MenuItem, MenuModifierGroup } from '$lib/types'

	// One-time idempotency key per logical sale — reused across retries so a
	// double-submit/network retry can never create a duplicate POS order.
	let saleKey = $state('')

	type CartLine = {
		menuItemId: string
		name: string
		price: number
		quantity: number
		modifiers: { modifierId: string; name: string; price: number }[]
	}
	type ModifierChoice = { group: MenuModifierGroup; selected: Map<string, number> }

	let menu = $state<MenuItem[]>([])
	let categories = $state<{ id: string; name: string }[]>([])
	let loading = $state(true)
	let category = $state('')
	let query = $state('')

	let cart = $state<CartLine[]>([])
	let customerName = $state('')
	let notes = $state('')
	let openItem = $state<MenuItem | null>(null)
	let choice = $state<ModifierChoice[]>([])
	let completing = $state(false)
	let paymentMethod = $state('card')
	let cashReceived = $state<number | null>(null)
	let placing = $state(false)
	let receiptOrder = $state<FoodOrder | null>(null)
	let receiptPaid = $state(false)

	// Split-tender state: extra partial payments collected in the payment
	// modal. The main paymentMethod/cashReceived below covers whatever
	// remains after these splits (amount omitted → server computes exact
	// remainder from its own totals).
	type PaySplit = { method: string; amount: number; cashReceived: number | null }
	let splits = $state<PaySplit[]>([])
	let splitMethod = $state('card')
	let splitAmount = $state<number | null>(null)
	let splitCash = $state<number | null>(null)
	let tipAmount = $state<number | null>(null)
	let discountAmount = $state<number | null>(null)
	let discountReason = $state('')
	let receiptPayments = $state<{ method: string; amount: number; change: number | null }[]>([])

	// Offline outbox: order+pay payloads queued in localStorage when the
	// network drops mid-sale. The saleKey (order idempotency key) is persisted
	// inside each queued payload so retries can never duplicate the order.
	const OUTBOX_KEY = 'ecom:pos-outbox'
	type OutboxPay = {
		paymentMethod?: string
		amount?: number
		cashReceived?: number
		tip?: number
		discountAmount?: number
		discountReason?: string
	}
	type OutboxItem = {
		saleKey: string
		orderId: string | null
		createBody: Record<string, unknown>
		pays: OutboxPay[]
		queuedAt: string
	}
	let outbox = $state<OutboxItem[]>([])
	let syncing = $state(false)
	let isOnline = $state(true)

	const canSell = $derived(session.can('orders.create'))

	// Use the in-session selected outlet (fall back to a local read for warm nav).
	function sessionOutletId(): string | null {
		return session.selectedOutletId ?? getSelectedOutletId()
	}

	function newSaleKey() {
		saleKey = crypto.randomUUID()
	}

	async function load() {
		loading = true
		try {
			const [menuRes, catRes] = await Promise.all([
				api.get<{ success: boolean; data: { items: MenuItem[] } }>('/api/menu', { limit: '500' }),
				api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/categories')
			])
			menu = menuRes.data.items.filter(
				(it) => it.status === 'active' && it.available && isPosVisible(it)
			)
			categories = catRes.data
			if (!category && categories.length) category = categories[0].id
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	// Only POS-visible products are sellable here. The menu payload may not
	// carry visibility (older API) — treat a missing flag as visible.
	function isPosVisible(it: MenuItem) {
		const vis = (it.product as { visibility?: string }).visibility
		return !vis || vis === 'pos' || vis === 'both'
	}

	function visibleItems() {
		let items = menu
		if (category) items = items.filter((it) => it.product.categoryId === category)
		if (query.trim()) {
			const q = query.trim().toLowerCase()
			items = items.filter(
				(it) =>
					it.product.name.toLowerCase().includes(q) ||
					it.product.sku?.toLowerCase().includes(q)
			)
		}
		return items
	}

	function cartTotal() {
		let subtotal = 0
		for (const line of cart) {
			const mods = line.modifiers.reduce((a, m) => a + m.price, 0)
			subtotal += (line.price + mods) * line.quantity
		}
		return subtotal
	}

	function openModifiers(item: MenuItem) {
		openItem = item
		choice = (item.modifierGroups ?? []).map((g) => ({ group: g, selected: new Map<string, number>() }))
	}

	function addToCart(item: MenuItem) {
		const groups = item.modifierGroups ?? []
		if (groups.length) return openModifiers(item)
		cart.push({ menuItemId: item.id, name: item.product.name, price: item.product.price, quantity: 1, modifiers: [] })
	}

	// Modifier-selection modal actions --------------------------------------
	function toggleModifier(groupIdx: number, modId: string) {
		const c = choice[groupIdx]
		const g = c.group
		const qty = c.selected.get(modId) ?? 0
		if (qty > 0) {
			c.selected.delete(modId)
		} else {
			if (g.maxSelections > 0 && c.selected.size >= g.maxSelections) {
				toast.error(t('pos.maxSelection', { count: String(g.maxSelections), name: g.name }))
				return
			}
			c.selected.set(modId, 1)
		}
		choice = choice.slice()
	}

	function confirmModifiers() {
		if (!openItem) return
		// Enforce required / minimum selection limits.
		for (const c of choice) {
			const min = c.group.required ? 1 : c.group.minSelections || 0
			if (c.selected.size < min) {
				toast.error(
					t('pos.minSelection', {
						min: String(min),
						options: min === 1 ? t('pos.option') : t('pos.options'),
						group: c.group.name
					})
				)
				return
			}
		}
		const mods = choice.flatMap((c) =>
			[...c.selected.entries()].map(([id, qty]) => {
				const m = c.group.modifiers.find((x) => x.id === id)
				return { modifierId: id, name: m?.name ?? id, price: Number(m?.priceAdjustment ?? 0) * qty, qty }
			})
		)
		cart.push({
			menuItemId: openItem.id,
			name: openItem.product.name + (mods.length ? ` (${mods.map((m) => m.name).join(', ')})` : ''),
			price: openItem.product.price,
			quantity: 1,
			modifiers: mods.map((m) => ({ modifierId: m.modifierId, name: m.name, price: m.price }))
		})
		openItem = null
	}

	function setQty(i: number, qty: number) {
		if (qty < 1) {
			cart.splice(i, 1)
		} else {
			cart[i].quantity = qty
		}
		cart = cart.slice()
	}

	function clearCart() {
		cart = []
		customerName = ''
		notes = ''
	}

	function linePrice(line: CartLine) {
		const mods = line.modifiers.reduce((a, m) => a + m.price, 0)
		return (line.price + mods) * line.quantity
	}

	const round2 = (n: number) => Math.round(n * 100) / 100
	const tipVal = () => Math.max(0, tipAmount ?? 0)
	const discVal = () => Math.max(0, discountAmount ?? 0)
	// Client-side estimate (server totals are authoritative once the order
	// exists — the final charge omits `amount` so the server bills exactly).
	const estimateTotal = () => round2(cartTotal() + tipVal() - discVal())
	const splitsTotal = () => round2(splits.reduce((a, s) => a + s.amount, 0))
	const remainingDue = () => round2(estimateTotal() - splitsTotal())

	function addSplit() {
		const amount = splitAmount ?? remainingDue()
		if (!(amount > 0)) {
			toast.error(t('pos.splitAmountInvalid'))
			return
		}
		if (splitMethod === 'cash' && splitCash !== null && splitCash < amount) {
			toast.error(t('pos.cashTooLittle'))
			return
		}
		splits = [...splits, { method: splitMethod, amount: round2(amount), cashReceived: splitMethod === 'cash' ? splitCash : null }]
		splitAmount = null
		splitCash = null
	}

	function removeSplit(i: number) {
		splits = splits.filter((_, idx) => idx !== i)
	}

	/** Anything that is not a server rejection is treated as a network failure. */
	function isOfflineError(e: unknown) {
		return !(e instanceof ApiError)
	}

	function loadOutbox() {
		try {
			const raw = localStorage.getItem(OUTBOX_KEY)
			outbox = raw ? (JSON.parse(raw) as OutboxItem[]) : []
		} catch {
			outbox = []
		}
	}

	function persistOutbox() {
		try {
			localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
		} catch {
			// Storage full/blocked — keep the in-memory queue.
		}
	}

	function queueOutbox(item: OutboxItem) {
		outbox = [...outbox, item]
		persistOutbox()
	}

	/** Replay queued sales: idempotent create (same saleKey) then each pay.
	 *  A pay that answers ALREADY_PAID means the payment already landed before
	 *  the disconnect, so the item is treated as synced. */
	async function syncOutbox() {
		if (syncing || outbox.length === 0 || !navigator.onLine) return
		syncing = true
		try {
			const pending: OutboxItem[] = []
			for (const item of outbox) {
				try {
					let orderId = item.orderId
					if (!orderId) {
						const res = await api.post<{ success: boolean; data: FoodOrder }>('/api/food-orders', {
							...item.createBody,
							idempotencyKey: item.saleKey
						})
						orderId = res.data.id
					}
					for (const p of item.pays) {
						try {
							await api.post(`/api/food-orders/${orderId}/pay`, p)
						} catch (e) {
							if (e instanceof ApiError && e.code === 'ALREADY_PAID') break
							throw e
						}
					}
				} catch (e) {
					if (e instanceof ApiError && e.code === 'ALREADY_PAID') continue
					pending.push(item)
					if (!(e instanceof ApiError)) break // still offline — stop trying
				}
			}
			const synced = outbox.length - pending.length
			outbox = pending
			persistOutbox()
			if (synced > 0) toast.success(t('pos.outboxSynced', { count: String(synced) }))
		} finally {
			syncing = false
		}
	}

	async function placeOrder() {
		if (cart.length === 0) {
			toast.error(t('pos.addItems'))
			return
		}
		const outletId = sessionOutletId()
		if (!outletId) {
			toast.error(t('pos.noOutlet'))
			return
		}
		if (placing) return
		placing = true

		const createBody = {
			orderType: 'POS',
			outletId,
			customerName: customerName || undefined,
			notes: notes || undefined,
			idempotencyKey: saleKey,
			items: cart.map((line) => ({
				menuItemId: line.menuItemId,
				quantity: line.quantity,
				modifiers: line.modifiers.length ? line.modifiers.map((m) => ({ modifierId: m.modifierId })) : undefined
			}))
		}
		// Tip/discount ride on the first payment (they accumulate server-side,
		// so they must be sent exactly once). The final payment omits `amount`
		// so the server bills its exact remaining balance (incl. tax).
		const firstExtras = {
			...(tipVal() > 0 ? { tip: tipVal() } : {}),
			...(discVal() > 0 ? { discountAmount: discVal() } : {}),
			...(discountReason.trim() ? { discountReason: discountReason.trim() } : {})
		}
		const splitPays: OutboxPay[] = splits.map((s, i) => ({
			paymentMethod: s.method,
			amount: s.amount,
			...(s.cashReceived !== null ? { cashReceived: s.cashReceived } : {}),
			...(i === 0 ? firstExtras : {})
		}))
		const finalPay: OutboxPay = {
			paymentMethod,
			...(paymentMethod === 'cash' && cashReceived !== null ? { cashReceived } : {}),
			...(splitPays.length === 0 ? firstExtras : {})
		}
		const pays = remainingDue() > 0.001 || splitPays.length === 0
			? [...splitPays, finalPay]
			: splitPays

		let orderId: string | null = null
		let payIdx = 0
		try {
			const res = await api.post<{ success: boolean; data: FoodOrder }>('/api/food-orders', createBody)
			let order = res.data
			orderId = order.id

			// Capture payment(s) — authorized + audited on the server.
			const taken: { method: string; amount: number; change: number | null }[] = []
			try {
				for (; payIdx < pays.length; payIdx++) {
					const p = pays[payIdx]
					const paid = await api.post<{ success: boolean; data: FoodOrder }>(
						`/api/food-orders/${orderId}/pay`,
						p
					)
					order = paid.data
					// Last pay may omit `amount` — derive what was applied from
					// the server's authoritative totals for the receipt.
					const serverBalance =
						Number(order.total) + Number(order.tipTotal ?? 0) - Number(order.discountTotal ?? 0)
					const appliedSoFar = taken.reduce((a, x) => a + x.amount, 0)
					const applied = p.amount ?? round2(serverBalance - appliedSoFar)
					const tender = p.cashReceived ?? applied
					taken.push({
						method: p.paymentMethod ?? 'cash',
						amount: applied,
						change: (p.paymentMethod ?? 'cash') === 'cash' ? round2(tender - applied) : null
					})
				}
			} catch (payErr) {
				if (isOfflineError(payErr) && orderId) {
					// Order exists on the server; queue only the unsent payments.
					queueOutbox({ saleKey, orderId, createBody, pays: pays.slice(payIdx), queuedAt: new Date().toISOString() })
					toast.error(t('pos.offlineQueued'))
					completing = false
					return
				}
				toast.error(t('pos.paymentNotRecorded', { message: (payErr as Error).message }))
			}

			receiptOrder = order
			receiptPaid = order.paymentStatus === 'paid'
			receiptPayments = taken
			completing = false
			clearCart()
		} catch (e) {
			if (isOfflineError(e)) {
				// Create never reached the server — queue the whole sale with
				// its idempotency key so the retry cannot duplicate the order.
				queueOutbox({ saleKey, orderId, createBody, pays, queuedAt: new Date().toISOString() })
				toast.error(t('pos.offlineQueued'))
				completing = false
			} else {
				toast.error((e as Error).message)
			}
		} finally {
			placing = false
		}
	}

	function startSale() {
		receiptOrder = null
		receiptPayments = []
		splits = []
		splitAmount = null
		splitCash = null
		tipAmount = null
		discountAmount = null
		discountReason = ''
		cashReceived = null
		clearCart()
		newSaleKey()
	}

	onMount(() => {
		newSaleKey()
		loadOutbox()
		isOnline = navigator.onLine
		const goOnline = () => {
			isOnline = true
			void syncOutbox()
		}
		const goOffline = () => {
			isOnline = false
		}
		window.addEventListener('online', goOnline)
		window.addEventListener('offline', goOffline)
		if (isOnline && outbox.length > 0) void syncOutbox()
		void load()
		return () => {
			window.removeEventListener('online', goOnline)
			window.removeEventListener('offline', goOffline)
		}
	})
</script>

<svelte:head><title>{t('pos.title')} — JamiCore</title></svelte:head>

<div class="space-y-6">
	<div class="mb-4 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">{t('pos.register')}</h1>
			<p class="mt-1 text-body-sm text-secondary">{t('pos.subtitle')}</p>
		</div>
		<div class="flex items-center gap-3">
			{#if session.allowedOutlets.length > 1}
				<select
					class="field w-auto"
					value={sessionOutletId() ?? ''}
					onchange={(e) => session.switchOutlet(e.currentTarget.value)}
				>
					{#each session.allowedOutlets as o (o.id)}
						<option value={o.id}>{o.name}</option>
					{/each}
				</select>
			{/if}
			{#if cart.length}
				<Button variant="secondary" onclick={clearCart}><Icon name="delete_sweep" size="text-[18px]" /> {t('pos.clear')}</Button>
			{/if}
			{#if outbox.length > 0}
				<span class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning" role="status">
					<Icon name="cloud_off" size="text-[16px]" />
					{isOnline ? t('pos.queuedSync', { count: String(outbox.length) }) : t('pos.offlineQueuedCount', { count: String(outbox.length) })}
				</span>
				<Button variant="secondary" onclick={() => void syncOutbox()} loading={syncing} disabled={syncing}>
					<Icon name="sync" size="text-[18px]" /> {t('pos.syncNow')}
				</Button>
			{:else if !isOnline}
				<span class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning" role="status">
					<Icon name="cloud_off" size="text-[16px]" /> {t('pos.offline')}
				</span>
			{/if}
		</div>
	</div>

	<div class="grid gap-5 lg:grid-cols-[1fr_360px]">
		
		<div class="space-y-4">
			{#if loading}
				<div class="py-16 text-center text-sm text-secondary">{t('pos.loading')}</div>
			{:else if categories.length}
				<div class="flex flex-wrap gap-2">
					<button
						class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {category === '' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}"
						onclick={() => (category = '')}
					>
						{t('pos.allItems')}
					</button>
					{#each categories as c (c.id)}
						<button
							class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {category === c.id ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}"
							onclick={() => (category = c.id)}
						>
							{c.name}
						</button>
					{/each}
				</div>
				<div class="relative mt-3">
					<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
						<Icon name="search" size="text-[16px]" />
					</div>
					<input
						class="field pl-9"
						bind:value={query}
						placeholder={t('pos.searchPlaceholder')}
						aria-label={t('pos.searchPlaceholder')}
					/>
				</div>
			{/if}

			{#if visibleItems().length === 0}
				<div class="flex flex-col items-center gap-2 py-16 text-center">
					<Icon name="restaurant_menu" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">{query.trim() ? t('pos.searchNoResults') : t('pos.categoryEmpty')}</p>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
					{#each visibleItems() as item (item.id)}
						<button
							class="group flex flex-col rounded border border-outline-variant bg-surface-container-lowest p-3 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
							onclick={() => addToCart(item)}
						>
							<span class="font-medium text-on-surface">{item.product.name}</span>
							<span class="mt-auto pt-1 font-mono-label text-mono-label text-primary">
								{currency(item.product.price)}
							</span>
							<span class="mt-1 text-xs text-secondary">{item.preparationTimeMin > 0 ? `${item.preparationTimeMin}m` : ''}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		
		<Card class="lg:sticky lg:top-6 self-start">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="font-display text-title-md text-on-surface">{t('pos.cart')}</h2>
				<span class="text-xs text-secondary">{t('pos.itemsCount', { count: String(cart.length), s: cart.length === 1 ? '' : 's' })}</span>
			</div>

			{#if cart.length === 0}
				<div class="flex flex-col items-center gap-2 py-10 text-center text-secondary">
					<Icon name="shopping_cart" size="text-[28px]" class="text-outline" />
					<p class="text-sm">{t('pos.tapToAdd')}</p>
				</div>
			{:else}
				<div class="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
					{#each cart as line, i (line.menuItemId + i)}
						<div class="rounded border border-outline-variant bg-surface-container-lowest p-2.5">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<div class="truncate text-sm font-medium text-on-surface">{line.name}</div>
									<div class="flex items-center justify-between pt-1.5">
										<div class="flex items-center gap-1.5">
											<button
												class="flex h-6 w-6 items-center justify-center rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
												onclick={() => setQty(i, line.quantity - 1)}
												aria-label={t('pos.decreaseQty')}
											>−</button>
											<span class="w-5 text-center text-sm font-medium">{line.quantity}</span>
											<button
												class="flex h-6 w-6 items-center justify-center rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
												onclick={() => setQty(i, line.quantity + 1)}
												aria-label={t('pos.increaseQty')}
											>+</button>
										</div>
										<span class="font-mono-label text-mono-label text-on-surface">{currency(linePrice(line))}</span>
									</div>
								</div>
								<button
									class="rounded p-1 text-xs text-error hover:bg-error-container/40"
									onclick={() => setQty(i, 0)}
									aria-label={t('pos.removeItem')}
								>✕</button>
							</div>
						</div>
					{/each}
				</div>

				<div class="mt-4 space-y-1 border-t border-outline-variant pt-3 text-sm">
					<div class="flex justify-between text-secondary"><span>{t('pos.subtotal')}</span><span class="text-on-surface-variant">{currency(cartTotal())}</span></div>
					<div class="flex justify-between font-semibold text-on-surface"><span>{t('pos.total')}</span><span>{currency(cartTotal())}</span></div>
				</div>

				<div class="mt-4 space-y-3">
					<div>
						<label for="pos-customer" class="field-label">{t('pos.customer')}</label>
						<input id="pos-customer" class="field" bind:value={customerName} placeholder={t('pos.walkInGuest')} />
					</div>
					<div>
						<label for="pos-notes" class="field-label">{t('pos.notes')}</label>
						<input id="pos-notes" class="field" bind:value={notes} placeholder={t('pos.specialInstructions')} />
					</div>
				</div>

				<div class="mt-4">
					<Button class="w-full" size="md" onclick={() => { completing = true }} disabled={!canSell}>
						<Icon name="point_of_sale" size="text-[20px]" /> {t('pos.charge')} {currency(cartTotal())}
					</Button>
				</div>
			{/if}
		</Card>
	</div>
</div>

{#if openItem}
	<Modal open={true} title={openItem.product.name} onClose={() => (openItem = null)}>
		<div class="space-y-4">
			{#each choice as c, gi (c.group.id)}
				<div>
					<div class="mb-2 flex items-center justify-between">
						<span class="font-medium text-on-surface">{c.group.name}</span>
						<span class="text-xs text-secondary">
							{c.group.required ? t('pos.required') : t('pos.optional')}
							{c.group.maxSelections > 0 ? ` · ${t('pos.upTo', { count: String(c.group.maxSelections) })}` : ''}
						</span>
					</div>
					<div class="grid gap-2">
						{#each c.group.modifiers as m (m.id)}
							<button
								class="flex items-center justify-between rounded border px-3 py-2 text-left text-sm transition-colors {c.selected.has(m.id) ? 'border-primary bg-primary/10 text-on-surface' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'}"
								onclick={() => toggleModifier(gi, m.id)}
								disabled={!m.available || m.status !== 'active'}
							>
								<span>{m.name}</span>
								<span class="font-mono-label text-mono-label">{m.priceAdjustment > 0 ? `+${currency(m.priceAdjustment)}` : m.priceAdjustment === 0 ? '—' : `−${currency(Math.abs(m.priceAdjustment))}`}</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
			<div class="flex justify-end gap-2 pt-1">
				<Button variant="secondary" onclick={() => (openItem = null)}>{t('pos.cancel')}</Button>
				<Button onclick={confirmModifiers}>{t('pos.addToOrder')}</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if completing}
	<Modal open={true} title={t('pos.payment')} onClose={() => { if (!placing) completing = false }} width="sm">
		<div class="space-y-4">
			<div class="flex items-center justify-between rounded border border-outline-variant bg-surface-container-lowest p-3">
				<span class="text-sm text-secondary">{t('pos.totalDue')}</span>
				<span class="font-mono-label text-mono-label text-on-surface">{currency(cartTotal())}</span>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="pos-tip" class="field-label">{t('pos.tip')}</label>
					<input
						id="pos-tip"
						type="number"
						inputmode="decimal"
						min="0"
						step="0.01"
						class="field"
						bind:value={tipAmount}
						placeholder="0.00"
					/>
				</div>
				<div>
					<label for="pos-discount" class="field-label">{t('pos.discount')}</label>
					<input
						id="pos-discount"
						type="number"
						inputmode="decimal"
						min="0"
						step="0.01"
						class="field"
						bind:value={discountAmount}
						placeholder="0.00"
					/>
				</div>
			</div>
			{#if (discountAmount ?? 0) > 0}
				<div>
					<label for="pos-discount-reason" class="field-label">{t('pos.discountReason')}</label>
					<input
						id="pos-discount-reason"
						class="field"
						bind:value={discountReason}
						placeholder={t('pos.discountReasonPlaceholder')}
					/>
				</div>
			{/if}
			<div class="rounded border border-outline-variant p-3">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-on-surface">{t('pos.splitPayments')}</span>
					<span class="text-sm text-secondary">{t('pos.remaining')}: <span class="font-mono-label text-mono-label text-on-surface">{currency(Math.max(0, remainingDue()))}</span></span>
				</div>
				{#if splits.length > 0}
					<ul class="mb-3 space-y-1.5">
						{#each splits as s, i (i)}
							<li class="flex items-center justify-between rounded bg-surface-container-low px-2.5 py-1.5 text-sm">
								<span class="text-on-surface-variant">{s.method} · {currency(s.amount)}{s.cashReceived !== null ? ` (${t('pos.cashReceived')}: ${currency(s.cashReceived)})` : ''}</span>
								<span class="flex items-center gap-2">
									<span class="font-mono-label text-mono-label text-on-surface">{currency(s.amount)}</span>
									<button
										class="rounded p-1 text-xs text-error hover:bg-error-container/40"
										onclick={() => removeSplit(i)}
										aria-label={t('pos.removeSplit')}
									>✕</button>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="grid grid-cols-[1fr_110px_auto] gap-2">
					<select class="field" bind:value={splitMethod} aria-label={t('pos.paymentMethod')}>
						<option value="card">{t('pos.card')}</option>
						<option value="cash">{t('pos.cash')}</option>
						<option value="bank_transfer">{t('pos.bankTransfer')}</option>
						<option value="wallet">{t('pos.wallet')}</option>
						<option value="gift_card">{t('pos.giftCard')}</option>
					</select>
					<input
						type="number"
						inputmode="decimal"
						min="0.01"
						step="0.01"
						class="field"
						bind:value={splitAmount}
						placeholder={String(Math.max(0, remainingDue()))}
						aria-label={t('pos.splitAmount')}
					/>
					<Button variant="secondary" onclick={addSplit}>{t('pos.addSplit')}</Button>
				</div>
				{#if splitMethod === 'cash'}
					<input
						type="number"
						inputmode="decimal"
						min="0"
						step="0.01"
						class="field mt-2"
						bind:value={splitCash}
						placeholder={t('pos.cashReceived')}
						aria-label={t('pos.cashReceived')}
					/>
				{/if}
			</div>
			<div>
				<label for="pos-pay-method" class="field-label">{t('pos.paymentMethod')}</label>
				<select id="pos-pay-method" class="field" bind:value={paymentMethod}>
					<option value="card">{t('pos.card')}</option>
					<option value="cash">{t('pos.cash')}</option>
					<option value="bank_transfer">{t('pos.bankTransfer')}</option>
					<option value="wallet">{t('pos.wallet')}</option>
					<option value="gift_card">{t('pos.giftCard')}</option>
				</select>
			</div>
			{#if paymentMethod === 'cash'}
				<div>
					<label for="pos-cash-received" class="field-label">{t('pos.cashReceived')}</label>
					<input
						id="pos-cash-received"
						type="number"
						inputmode="decimal"
						min={cartTotal()}
						step="0.01"
						class="field"
						bind:value={cashReceived}
						placeholder={String(cartTotal())}
					/>
					{#if cashReceived !== null && cashReceived >= cartTotal()}
						<p class="mt-1 text-sm text-on-surface-variant">
							{t('pos.change')}: {currency(cashReceived - cartTotal())}
						</p>
					{/if}
				</div>
			{/if}
			<div class="pt-1">
				<Button class="w-full" size="md" onclick={placeOrder} loading={placing} disabled={placing}>
					<Icon name="check" size="text-[20px]" /> {t('pos.charge')} {currency(Math.max(0, remainingDue()))}
				</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if receiptOrder}
	<Modal open={true} title={t('pos.receiptFor', { orderNumber: receiptOrder.orderNumber })} onClose={startSale}>
		<div class="space-y-3">
			<div class="flex items-center gap-2 text-sm">
				<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {receiptPaid ? 'bg-success/10 text-success ring-success' : 'bg-warning/10 text-warning ring-warning'}">
					{receiptPaid ? t('pos.paid') : receiptOrder.paymentStatus}
				</span>
				<span class="text-secondary">{t('pos.posOrder')}</span>
			</div>

			<div class="divide-y divide-outline-variant/60 rounded border border-outline-variant">
				{#each receiptOrder.items as line (line.id)}
					<div class="flex items-start justify-between p-3 text-sm">
						<div>
							<div class="font-medium text-on-surface">{line.quantity}× {line.name}</div>
							{#if line.modifiers.length}
								<div class="mt-0.5 text-xs text-on-surface-variant">
									{#each line.modifiers as m}{m.name}{m.quantity > 1 ? ` ×${m.quantity}` : ''} · {/each}
								</div>
							{/if}
						</div>
						<span class="font-mono-label text-mono-label text-on-surface">{currency(line.total)}</span>
					</div>
				{/each}
			</div>

			<div class="space-y-1 text-sm">
				<div class="flex justify-between text-secondary"><span>{t('pos.subtotal')}</span><span class="text-on-surface-variant">{currency(receiptOrder.subtotal)}</span></div>
				<div class="flex justify-between text-secondary"><span>{t('pos.tax')}</span><span class="text-on-surface-variant">{currency(receiptOrder.taxTotal)}</span></div>
				{#if (receiptOrder.tipTotal ?? 0) > 0}
					<div class="flex justify-between text-secondary"><span>{t('pos.tip')}</span><span class="text-on-surface-variant">{currency(receiptOrder.tipTotal ?? 0)}</span></div>
				{/if}
				{#if (receiptOrder.discountTotal ?? 0) > 0}
					<div class="flex justify-between text-secondary"><span>{t('pos.discount')}</span><span class="text-on-surface-variant">−{currency(receiptOrder.discountTotal ?? 0)}</span></div>
				{/if}
				<div class="flex justify-between font-semibold text-on-surface"><span>{t('pos.total')}</span><span>{currency(receiptOrder.total)}</span></div>
			</div>

			{#if receiptPayments.length > 0}
				<div class="space-y-1 text-sm">
					<div class="text-xs font-medium text-secondary">{t('pos.payments')}</div>
					{#each receiptPayments as p (p.method + p.amount)}
						<div class="flex justify-between text-secondary">
							<span>{p.method}{p.change !== null && p.change > 0 ? ` (${t('pos.change')}: ${currency(p.change)})` : ''}</span>
							<span class="text-on-surface-variant">{currency(p.amount)}</span>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex gap-2 pt-1">
				<Button class="flex-1" onclick={startSale}><Icon name="add" size="text-[18px]" /> {t('pos.newSale')}</Button>
				<Button class="flex-1" variant="secondary" onclick={() => (receiptOrder = null)}>{t('pos.close')}</Button>
			</div>
		</div>
	</Modal>
{/if}