<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTimeFull, number, titleCase } from '$lib/format'
	import type { OrderDetail, OrderItem, ReturnRecord } from '$lib/types'
	import { page } from '$app/state'

	let order = $state<OrderDetail | null>(null)
	let loading = $state(true)
	let id = $derived(page.params.id)
	let saving = $state(false)

	let returnOpen = $state(false)
	let returnItemId = $state('')
	let returnQty = $state('1')
	let returnReason = $state('')
	let returnItem = $state<OrderItem | null>(null)

	let refundOpen = $state(false)
	let refundAmount = $state('')
	let refundMethod = $state<'original'>('original')
	let refundReturnId = $state('')

	const canWrite = () => session.can('orders:write')

	const TRANSITIONS: Record<string, string[]> = {
		pending: ['processing', 'cancelled'],
		processing: ['shipped', 'cancelled'],
		shipped: ['delivered', 'cancelled'],
		delivered: ['refunded'],
		cancelled: [],
		refunded: []
	}

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: OrderDetail }>(`/api/orders/${id}`)
			order = res.data
			refundAmount = order.refunds.length === 0 ? String(order.total) : String((order.total - order.refunds.reduce((s, r) => s + r.amount, 0)).toFixed(2))
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	$effect(() => {
		load()
	})

	function openReturn(item: OrderItem) {
		returnItem = item
		returnItemId = item.id
		returnQty = String(item.quantity)
		returnReason = ''
		returnOpen = true
	}

	async function submitReturn() {
		saving = true
		try {
			await api.post<{ success: boolean }>('/api/returns', {
				orderId: id,
				orderItemId: returnItemId,
				quantity: Number(returnQty),
				...(returnReason ? { reason: returnReason } : {})
			})
			toast.success('Return requested')
			returnOpen = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function setReturnStatus(r: ReturnRecord, status: 'approved' | 'rejected') {
		if (!confirm(`Mark return ${status}?`)) return
		try {
			await api.patch<{ success: boolean }>(`/api/returns/${r.id}`, { status })
			toast.success(`Return ${status}`)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function submitRefund() {
		saving = true
		try {
			await api.post<{ success: boolean }>('/api/refunds', {
				orderId: id,
				...(refundReturnId ? { returnId: refundReturnId } : {}),
				amount: Number(refundAmount),
				method: refundMethod
			})
			toast.success('Refund recorded')
			refundOpen = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function setStatus(status: string) {
		saving = true
		try {
			await api.patch<{ success: boolean }>(`/api/orders/${id}/status`, { status })
			toast.success(`Order → ${titleCase(status)}`)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function cancelOrder() {
		if (!confirm(`Cancel order #${order?.orderNumber}? Inventory will be restocked.`)) return
		saving = true
		try {
			await api.post<{ success: boolean }>(`/api/orders/${id}/cancel`)
			toast.success('Order cancelled')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	const pendingReturns = () => (order?.returns ?? []).filter((r) => r.status === 'pending')
	const availableToReturn = (item: OrderItem) => {
		if (!order) return 0
		const already = order.returns
			.filter((r) => r.orderItemId === item.id && r.status !== 'rejected')
			.reduce((s, r) => s + r.quantity, 0)
		return item.quantity - already
	}
	const refundable = () => {
		if (!order) return 0
		const already = order.refunds.reduce((s, r) => s + r.amount, 0)
		return Math.max(0, Number((order.total - already).toFixed(2)))
	}
</script>

<svelte:head>
	<title>Order #{page.params.id} — Merchant OS</title>
</svelte:head>

{#if loading}
	<div class="h-40 animate-pulse rounded bg-surface-container"></div>
{:else if order}
	<div class="space-y-6">
		<!-- Page header -->
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<a href="/orders" class="inline-flex items-center gap-1 py-1 text-body-sm text-secondary hover:text-primary">
					<Icon name="arrow_back" size="text-[16px]" />
					Orders
				</a>
				<h1 class="mt-1 font-display text-display text-on-surface">Order #{order.orderNumber}</h1>
				<p class="mt-1 text-body-sm text-secondary">{dateTimeFull(order.createdAt)}</p>
			</div>
			{#if canWrite() && order.status !== 'cancelled' && order.status !== 'refunded'}
				<div class="flex flex-wrap gap-2">
					{#each TRANSITIONS[order.status] ?? [] as next (next)}
						<Button
							variant="secondary"
							size="sm"
							onclick={() => setStatus(next)}
							disabled={saving}
						>
							{next === 'cancelled' ? 'Mark cancelled' : titleCase(next)}
						</Button>
					{/each}
					<Button
						variant="danger"
						size="sm"
						onclick={cancelOrder}
						disabled={saving}
					>
						Cancel order
					</Button>
					<Button variant="secondary" size="sm" onclick={() => (refundOpen = true)} disabled={saving || refundable() <= 0}>
						Record refund
					</Button>
				</div>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2.5">
			<div class="inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm">
				<span class="text-xs text-secondary">Status</span>
				<Badge label={order.status} />
			</div>
			<div class="inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm">
				<span class="text-xs text-secondary">Payment</span>
				<Badge label={order.paymentStatus} />
			</div>
			<div class="inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm">
				<span class="text-xs text-secondary">Fulfillment</span>
				<Badge label={order.fulfillmentStatus} />
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<!-- Items -->
			<div class="space-y-6 lg:col-span-2">
				<Card title={`Items (${order.items.length})`} padded={false}>
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Item</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Price</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Qty</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Total</th>
								{#if canWrite()}
									<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each order.items as item (item.id)}
								<tr class="border-b border-outline-variant/60">
									<td class="px-table-cell-x py-table-cell-y">
										<p class="font-medium text-on-surface">{item.name}</p>
										{#if item.sku}<p class="text-xs text-secondary">{item.sku}</p>{/if}
										{#if Object.keys(item.optionValues ?? {}).length}
											<p class="text-xs text-secondary">{Object.entries(item.optionValues ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
										{/if}
									</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{currency(item.price, order.currency)}</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(item.quantity)}</td>
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(item.total, order.currency)}</td>
									{#if canWrite()}
										<td class="px-table-cell-x py-table-cell-y text-right">
											<button
												class="inline-flex items-center gap-1 rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40"
												disabled={availableToReturn(item) <= 0}
												class:opacity-40={availableToReturn(item) <= 0}
												onclick={() => openReturn(item)}
											>
												<Icon name="assignment_return" size="text-[16px]" />
												Return
											</button>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</Card>

				{#if order.returns.length > 0}
					<Card title="Returns" padded={false}>
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
									<th class="px-table-cell-x py-table-cell-y font-semibold">Item</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Qty</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Amount</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each order.returns as r (r.id)}
									<tr class="border-b border-outline-variant/60">
										<td class="px-table-cell-x py-table-cell-y">
											<p class="text-sm text-on-surface">{order.items.find((i) => i.id === r.orderItemId)?.name ?? 'Item'}</p>
											{#if r.reason}<p class="text-xs text-secondary">{r.reason}</p>{/if}
										</td>
										<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(r.quantity)}</td>
										<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{currency(r.amount, order.currency)}</td>
										<td class="px-table-cell-x py-table-cell-y"><Badge label={r.status} /></td>
										<td class="px-table-cell-x py-table-cell-y">
											{#if canWrite() && r.status === 'pending'}
												<div class="flex gap-2">
													<button class="inline-block rounded p-1.5 text-xs font-medium text-success hover:bg-primary-fixed-dim/40" onclick={() => setReturnStatus(r, 'approved')}>Approve</button>
													<button class="inline-block rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => setReturnStatus(r, 'rejected')}>Reject</button>
												</div>
											{:else}
												<span class="text-xs text-outline">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</Card>
				{/if}

				{#if order.refunds.length > 0}
					<Card title="Refunds" padded={false}>
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
									<th class="px-table-cell-x py-table-cell-y font-semibold">Amount</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Method</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">When</th>
								</tr>
							</thead>
							<tbody>
								{#each order.refunds as r (r.id)}
									<tr class="border-b border-outline-variant/60">
										<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(r.amount, order.currency)}</td>
										<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{titleCase(r.method)}</td>
										<td class="px-table-cell-x py-table-cell-y"><Badge label={r.status} /></td>
										<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(r.createdAt)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</Card>
				{/if}
			</div>

			<!-- Summary sidebar -->
			<div class="space-y-6">
				<Card title="Summary">
					<dl class="space-y-2 text-sm">
						<div class="flex justify-between"><dt class="text-secondary">Subtotal</dt><dd class="text-on-surface-variant">{currency(order.subtotal, order.currency)}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Shipping</dt><dd class="text-on-surface-variant">{currency(order.shippingTotal, order.currency)}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Discount</dt><dd class="text-success">−{currency(order.discountTotal, order.currency)}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Tax</dt><dd class="text-on-surface-variant">{currency(order.taxTotal, order.currency)}</dd></div>
						<div class="flex justify-between border-t border-outline-variant pt-2 text-base font-semibold text-on-surface"><dt>Total</dt><dd>{currency(order.total, order.currency)}</dd></div>
						{#if order.refunds.length}
							<div class="flex justify-between text-error"><dt>Refunded</dt><dd>−{currency(order.refunds.reduce((s, r) => s + r.amount, 0), order.currency)}</dd></div>
							<div class="flex justify-between font-medium text-on-surface"><dt>Balance</dt><dd>{currency(refundable(), order.currency)}</dd></div>
						{/if}
					</dl>
				</Card>

				{#if order.customer}
					<Card title="Customer">
						<div class="text-sm">
							<a href="/customers/{order.customer.id}" class="inline-block rounded py-1 font-medium text-primary hover:text-on-primary-fixed-variant hover:underline">
								{order.customer.firstName ?? ''} {order.customer.lastName ?? ''}
							</a>
							<p class="text-secondary">{order.customer.email}</p>
							{#if order.customer.phone}
								<p class="mt-1 text-secondary">{order.customer.phone}</p>
							{/if}
						</div>
					</Card>
				{/if}

				{#if order.shippingAddress}
					<Card title="Shipping address">
						<div class="space-y-0.5 text-sm text-on-surface-variant">
							{#if order.shippingAddress.name}<p class="font-medium text-on-surface">{order.shippingAddress.name}</p>{/if}
							{#if order.shippingAddress.line1}<p>{order.shippingAddress.line1}</p>{/if}
							{#if order.shippingAddress.line2}<p>{order.shippingAddress.line2}</p>{/if}
							<p>{[order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.postalCode].filter(Boolean).join(', ')}</p>
							{#if order.shippingAddress.country}<p>{order.shippingAddress.country}</p>{/if}
						</div>
					</Card>
				{/if}

				{#if order.notes}
					<Card title="Notes">
						<p class="whitespace-pre-line text-sm text-on-surface-variant">{order.notes}</p>
					</Card>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-secondary">
		Order not found.
	</div>
{/if}

<!-- Return modal -->
{#if returnOpen && canWrite() && returnItem}
	<Modal title={`Return ${returnItem.name}`} open={true} width="sm" onClose={() => (returnOpen = false)}>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault()
				submitReturn()
			}}
		>
			<p class="text-sm text-secondary">
				Purchased <span class="font-medium text-on-surface">{number(returnItem.quantity)}</span> ·
				Available to return <span class="font-medium text-on-surface">{number(availableToReturn(returnItem))}</span>
			</p>
			<div>
				<label for="return-qty" class="mb-1 block text-sm font-medium text-on-surface">Quantity</label>
				<input
					id="return-qty"
					type="number"
					class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary"
					bind:value={returnQty}
					max={availableToReturn(returnItem)}
					required
				/>
			</div>
			<div>
				<label for="return-reason" class="mb-1 block text-sm font-medium text-on-surface">Reason</label>
				<textarea id="return-reason" rows="2" class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={returnReason} placeholder="Optional"></textarea>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (returnOpen = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>Request return</Button>
			</div>
		</form>
	</Modal>
{/if}

<!-- Refund modal -->
{#if refundOpen && canWrite() && order}
	<Modal title="Record refund" open={true} width="sm" onClose={() => (refundOpen = false)}>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault()
				submitRefund()
			}}
		>
			{#if pendingReturns().length > 0}
				<div>
					<label for="refund-return" class="mb-1 block text-sm font-medium text-on-surface">Linked to return</label>
					<select id="refund-return" class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={refundReturnId}>
						<option value="">No return</option>
						{#each pendingReturns() as r (r.id)}
							<option value={r.id}>Return {r.id.slice(0, 8)} — {currency(r.amount, order.currency)}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div>
				<label for="refund-amount" class="mb-1 block text-sm font-medium text-on-surface">Amount (max {currency(refundable(), order.currency)})</label>
				<input id="refund-amount" type="number" step="0.01" min="0.01" class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={refundAmount} required />
			</div>
			<div>
				<label for="refund-method" class="mb-1 block text-sm font-medium text-on-surface">Method</label>
				<select id="refund-method" class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={refundMethod}>
					<option value="original">Original payment method</option>
				</select>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (refundOpen = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>Record refund</Button>
			</div>
		</form>
	</Modal>
{/if}