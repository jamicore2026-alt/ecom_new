<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Modal from '$lib/components/Modal.svelte'
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

{#if loading}
	<div class="h-40 animate-pulse rounded-xl bg-gray-200"></div>
{:else if order}
	<div class="space-y-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<a href="/orders" class="text-sm text-gray-500 hover:text-gray-700">← Orders</a>
				<h1 class="text-xl font-bold text-gray-900">Order #{order.orderNumber}</h1>
				<p class="text-sm text-gray-500">{dateTimeFull(order.createdAt)}</p>
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

		<div class="grid gap-4">
			<div class="flex flex-wrap gap-3">
				<div class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
					<span class="text-gray-500">Status: </span><Badge label={order.status} />
				</div>
				<div class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
					<span class="text-gray-500">Payment: </span><Badge label={order.paymentStatus} />
				</div>
				<div class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
					<span class="text-gray-500">Fulfillment: </span><Badge label={order.fulfillmentStatus} />
				</div>
			</div>
		</div>

		<div class="grid gap-5 lg:grid-cols-3">
			<!-- Items -->
			<div class="lg:col-span-2 space-y-5">
				<Card title={`Items (${order.items.length})`} padded={false}>
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
								<th class="px-5 py-3">Item</th>
								<th class="px-3 py-3">Price</th>
								<th class="px-3 py-3">Qty</th>
								<th class="px-3 py-3">Total</th>
								{#if canWrite()}
									<th class="px-5 py-3 text-right">Actions</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each order.items as item (item.id)}
								<tr class="border-b border-gray-50">
									<td class="px-5 py-3">
										<p class="font-medium text-gray-900">{item.name}</p>
										{#if item.sku}<p class="text-xs text-gray-500">{item.sku}</p>{/if}
										{#if Object.keys(item.optionValues ?? {}).length}
											<p class="text-xs text-gray-500">{Object.entries(item.optionValues ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
										{/if}
									</td>
									<td class="px-3 py-3">{currency(item.price, order.currency)}</td>
									<td class="px-3 py-3">{number(item.quantity)}</td>
									<td class="px-3 py-3 font-medium">{currency(item.total, order.currency)}</td>
									{#if canWrite()}
										<td class="px-5 py-3 text-right">
											<button
												class="text-xs font-medium text-indigo-600 hover:text-indigo-800"
												disabled={availableToReturn(item) <= 0}
												class:opacity-40={availableToReturn(item) <= 0}
												onclick={() => openReturn(item)}
											>
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
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
									<th class="px-5 py-3">Item</th>
									<th class="px-3 py-3">Qty</th>
									<th class="px-3 py-3">Amount</th>
									<th class="px-3 py-3">Status</th>
									<th class="px-5 py-3">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each order.returns as r (r.id)}
									<tr class="border-b border-gray-50">
										<td class="px-5 py-3">
											<p class="text-sm text-gray-800">{order.items.find((i) => i.id === r.orderItemId)?.name ?? 'Item'}</p>
											{#if r.reason}<p class="text-xs text-gray-500">{r.reason}</p>{/if}
										</td>
										<td class="px-3 py-3">{number(r.quantity)}</td>
										<td class="px-3 py-3">{currency(r.amount, order.currency)}</td>
										<td class="px-3 py-3"><Badge label={r.status} /></td>
										<td class="px-5 py-3">
											{#if canWrite() && r.status === 'pending'}
												<div class="flex gap-2">
													<button class="text-xs font-medium text-emerald-600 hover:text-emerald-800" onclick={() => setReturnStatus(r, 'approved')}>Approve</button>
													<button class="text-xs font-medium text-red-600 hover:text-red-800" onclick={() => setReturnStatus(r, 'rejected')}>Reject</button>
												</div>
											{:else}
												<span class="text-xs text-gray-400">—</span>
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
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
									<th class="px-5 py-3">Amount</th>
									<th class="px-3 py-3">Method</th>
									<th class="px-3 py-3">Status</th>
									<th class="px-5 py-3">When</th>
								</tr>
							</thead>
							<tbody>
								{#each order.refunds as r (r.id)}
									<tr class="border-b border-gray-50">
										<td class="px-5 py-3 font-medium">{currency(r.amount, order.currency)}</td>
										<td class="px-3 py-3 text-gray-700">{titleCase(r.method)}</td>
										<td class="px-3 py-3"><Badge label={r.status} /></td>
										<td class="px-5 py-3 text-gray-500">{dateTimeFull(r.createdAt)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</Card>
				{/if}
			</div>

			<!-- Summary sidebar -->
			<div class="space-y-5">
				<Card title="Summary">
					<dl class="space-y-2 text-sm">
						<div class="flex justify-between"><dt class="text-gray-500">Subtotal</dt><dd>{currency(order.subtotal, order.currency)}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Shipping</dt><dd>{currency(order.shippingTotal, order.currency)}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Discount</dt><dd class="text-emerald-600">−{currency(order.discountTotal, order.currency)}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Tax</dt><dd>{currency(order.taxTotal, order.currency)}</dd></div>
						<div class="flex justify-between border-t border-gray-100 pt-2 text-base font-semibold"><dt>Total</dt><dd>{currency(order.total, order.currency)}</dd></div>
						{#if order.refunds.length}
							<div class="flex justify-between text-red-600"><dt>Refunded</dt><dd>−{currency(order.refunds.reduce((s, r) => s + r.amount, 0), order.currency)}</dd></div>
							<div class="flex justify-between font-medium"><dt>Balance</dt><dd>{currency(refundable(), order.currency)}</dd></div>
						{/if}
					</dl>
				</Card>

				{#if order.customer}
					<Card title="Customer">
						<div class="text-sm">
							<a href="/customers/{order.customer.id}" class="font-medium text-indigo-600 hover:text-indigo-800">
								{order.customer.firstName ?? ''} {order.customer.lastName ?? ''}
							</a>
							<p class="text-gray-500">{order.customer.email}</p>
							{#if order.customer.phone}
								<p class="mt-1 text-gray-500">{order.customer.phone}</p>
							{/if}
						</div>
					</Card>
				{/if}

				{#if order.shippingAddress}
					<Card title="Shipping address">
						<div class="space-y-0.5 text-sm text-gray-700">
							{#if order.shippingAddress.name}<p class="font-medium">{order.shippingAddress.name}</p>{/if}
							{#if order.shippingAddress.line1}<p>{order.shippingAddress.line1}</p>{/if}
							{#if order.shippingAddress.line2}<p>{order.shippingAddress.line2}</p>{/if}
							<p>{[order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.postalCode].filter(Boolean).join(', ')}</p>
							{#if order.shippingAddress.country}<p>{order.shippingAddress.country}</p>{/if}
						</div>
					</Card>
				{/if}

				{#if order.notes}
					<Card title="Notes">
						<p class="whitespace-pre-line text-sm text-gray-600">{order.notes}</p>
					</Card>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<p class="text-sm text-gray-500">Order not found.</p>
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
			<p class="text-sm text-gray-500">
				Purchased <span class="font-semibold text-gray-900">{number(returnItem.quantity)}</span>·
				Available to return <span class="font-semibold text-gray-900">{number(availableToReturn(returnItem))}</span>
			</p>
			<div>
				<label for="return-qty" class="mb-1 block text-sm font-medium text-gray-700">Quantity</label>
				<input
					id="return-qty"
					type="number"
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
					bind:value={returnQty}
					max={availableToReturn(returnItem)}
					required
				/>
			</div>
			<div>
				<label for="return-reason" class="mb-1 block text-sm font-medium text-gray-700">Reason</label>
				<textarea id="return-reason" rows="2" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={returnReason} placeholder="Optional"></textarea>
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
					<label for="refund-return" class="mb-1 block text-sm font-medium text-gray-700">Linked to return</label>
					<select id="refund-return" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={refundReturnId}>
						<option value="">No return</option>
						{#each pendingReturns() as r (r.id)}
							<option value={r.id}>Return {r.id.slice(0, 8)} — {currency(r.amount, order.currency)}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div>
				<label for="refund-amount" class="mb-1 block text-sm font-medium text-gray-700">Amount (max {currency(refundable(), order.currency)})</label>
				<input id="refund-amount" type="number" step="0.01" min="0.01" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={refundAmount} required />
			</div>
			<div>
				<label for="refund-method" class="mb-1 block text-sm font-medium text-gray-700">Method</label>
				<select id="refund-method" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={refundMethod}>
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