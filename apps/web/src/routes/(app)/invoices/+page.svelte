<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import { currency, dateTimeFull } from '$lib/format'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import type { Invoice, PaginationMeta } from '$lib/types'

	let items = $state<Invoice[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)
	let search = $state('')
	let status = $state('')
	let type = $state('')
	let searchTimer: ReturnType<typeof setTimeout> | null = null
	let exporting = $state(false)
	let actingId = $state('')

	const canRead = () => session.can('orders.read')
	const canWrite = () => session.can('orders:write')

	async function load(p = 1) {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Invoice[]; meta: PaginationMeta } }>(
				'/api/invoices',
				{
					page: p,
					limit: meta.limit,
					...(search.trim() ? { search: search.trim() } : {}),
					...(status ? { status } : {}),
					...(type ? { type } : {})
				}
			)
			items = res.data.items
			meta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(() => load())

	function onPage(p: number) {
		load(p)
	}

	function onFilter() {
		if (searchTimer) clearTimeout(searchTimer)
		searchTimer = setTimeout(() => load(1), 300)
	}

	function downloadPdf(inv: Invoice) {
		api.download(`/api/invoices/${inv.id}/pdf`, `${inv.invoiceNumber}.pdf`).catch((e) => toast.error((e as Error).message))
	}

	// Bulk export: the server applies the current list filters; the UI
	// downloads each matching PDF sequentially (paginating past the first page).
	async function exportAll() {
		exporting = true
		try {
			let page = 1
			let total = 1
			let count = 0
			while (count < total) {
				const res = await api.get<{ success: boolean; data: { items: Invoice[]; meta: PaginationMeta } }>(
					'/api/invoices',
					{
						page,
						limit: 50,
						...(search.trim() ? { search: search.trim() } : {}),
						...(status ? { status } : {}),
						...(type ? { type } : {})
					}
				)
				total = res.data.meta.total
				for (const inv of res.data.items) {
					await api.download(`/api/invoices/${inv.id}/pdf`, `${inv.invoiceNumber}.pdf`).catch((e) => toast.error((e as Error).message))
					count++
				}
				page++
				if (res.data.items.length === 0) break
			}
			toast.success(`Exported ${count} invoice PDF(s)`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			exporting = false
		}
	}

	async function act(inv: Invoice, action: 'issue' | 'pay' | 'void' | 'send') {
		actingId = inv.id
		try {
			await api.post<{ success: boolean }>(`/api/invoices/${inv.id}/${action}`)
			toast.success(`Invoice ${action === 'send' ? 'sent' : action === 'void' ? 'voided' : action === 'pay' ? 'marked paid' : 'issued'}`)
			load(meta.page)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			actingId = ''
		}
	}
</script>

<svelte:head>
	<title>Invoices — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Invoices</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} total</p>
		</div>
		{#if canRead()}
			<Button variant="secondary" size="sm" onclick={exportAll} loading={exporting}>
				<Icon name="download" size="text-[16px]" /> Export PDFs
			</Button>
		{/if}
	</div>

	{#if !canRead()}
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
			You need the <span class="font-semibold text-on-surface">orders.read</span> permission to view this.
		</div>
	{:else}
		<Card>
			<div class="flex flex-col gap-3 md:flex-row">
				<input
					class="field flex-1"
					placeholder="Search invoice / order number or customer email"
					bind:value={search}
					oninput={onFilter}
				/>
				<select class="field w-full md:w-44" bind:value={status} onchange={() => load(1)}>
					<option value="">All statuses</option>
					<option value="draft">Draft</option>
					<option value="issued">Issued</option>
					<option value="paid">Paid</option>
					<option value="void">Void</option>
				</select>
				<select class="field w-full md:w-44" bind:value={type} onchange={() => load(1)}>
					<option value="">Invoices + credit notes</option>
					<option value="invoice">Invoices</option>
					<option value="credit_note">Credit notes</option>
				</select>
			</div>
		</Card>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<Card>
				<div class="flex flex-col items-center gap-3 py-16 text-center">
					<Icon name="receipt_long" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No invoices yet.</p>
				</div>
			</Card>
		{:else}
			<Card padded={false}>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Number</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Type</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Total</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each items as inv (inv.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{inv.invoiceNumber}</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{inv.invoiceType === 'credit_note' ? 'Credit Note' : 'Invoice'}</td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={inv.status} /></td>
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(inv.total)}</td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(inv.invoiceDate)}</td>
									<td class="px-table-cell-x py-table-cell-y">
										<a href="/orders/{inv.orderId}" class="text-primary hover:underline">{inv.orderId.slice(0, 8)}</a>
									</td>
									<td class="px-table-cell-x py-table-cell-y">
										<div class="flex flex-wrap justify-end gap-1">
											{#if canWrite() && inv.status === 'draft'}
												<button
													class="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40 disabled:opacity-40"
													disabled={actingId === inv.id}
													onclick={() => act(inv, 'issue')}
												>
													Issue
												</button>
											{/if}
											{#if canWrite() && inv.status === 'issued'}
												<button
													class="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40 disabled:opacity-40"
													disabled={actingId === inv.id}
													onclick={() => act(inv, 'send')}
												>
													Send
												</button>
												<button
													class="rounded-md px-2 py-1 text-xs font-medium text-success hover:bg-primary-fixed-dim/40 disabled:opacity-40"
													disabled={actingId === inv.id}
													onclick={() => act(inv, 'pay')}
												>
													Pay
												</button>
												<button
													class="rounded-md px-2 py-1 text-xs font-medium text-error hover:bg-error-container/40 disabled:opacity-40"
													disabled={actingId === inv.id}
													onclick={() => act(inv, 'void')}
												>
													Void
												</button>
											{/if}
											<button
												class="inline-flex items-center gap-1 rounded-md border border-outline-variant px-2 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
												title="Download PDF"
												onclick={() => downloadPdf(inv)}
											>
												<Icon name="download" size="text-[14px]" />
												PDF
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Pagination {meta} {onPage} />
			</Card>
		{/if}
	{/if}
</div>
