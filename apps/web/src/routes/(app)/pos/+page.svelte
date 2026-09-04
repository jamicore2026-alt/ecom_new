<script lang="ts">
	import { onMount } from 'svelte'
	import { api, getSelectedOutletId } from '$lib/api'
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
	let placing = $state(false)
	let receiptOrder = $state<FoodOrder | null>(null)
	let receiptPaid = $state(false)

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
				(it) => it.status === 'active' && it.available
			)
			categories = catRes.data
			if (!category && categories.length) category = categories[0].id
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
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

		try {
			const res = await api.post<{ success: boolean; data: FoodOrder }>('/api/food-orders', {
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
			})
			const order = res.data

			// Capture payment — authorized + audited on the server. A paid order
			// is returned unchanged, so replaying the same idempotent sale stays safe.
			let paid = false
			try {
				await api.post<{ success: boolean; data: FoodOrder }>(`/api/food-orders/${order.id}/pay`, {
					paymentMethod
				})
				paid = true
			} catch (payErr) {
				toast.error(t('pos.paymentNotRecorded', { message: (payErr as Error).message }))
			}

			receiptOrder = order
			receiptPaid = paid
			completing = false
			clearCart()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			placing = false
		}
	}

	function startSale() {
		receiptOrder = null
		clearCart()
		newSaleKey()
	}

	onMount(() => {
		newSaleKey()
		load()
	})
</script>

<svelte:head><title>{t('pos.title')} — Merchant OS</title></svelte:head>

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
			<div class="pt-1">
				<Button class="w-full" size="md" onclick={placeOrder} loading={placing} disabled={placing}>
					<Icon name="check" size="text-[20px]" /> {t('pos.charge')} {currency(cartTotal())}
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
				<div class="flex justify-between font-semibold text-on-surface"><span>{t('pos.total')}</span><span>{currency(receiptOrder.total)}</span></div>
			</div>

			<div class="flex gap-2 pt-1">
				<Button class="flex-1" onclick={startSale}><Icon name="add" size="text-[18px]" /> {t('pos.newSale')}</Button>
				<Button class="flex-1" variant="secondary" onclick={() => (receiptOrder = null)}>{t('pos.close')}</Button>
			</div>
		</div>
	</Modal>
{/if}