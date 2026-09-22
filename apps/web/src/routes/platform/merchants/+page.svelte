<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { platformApi } from '$lib/platform-api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Button from '$lib/components/Button.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { dateTimeFull } from '$lib/format'
	import { MERCHANT_STATUSES } from '$lib/types'
	import type { PlatformMerchantSummary, PaginationMeta } from '$lib/types'

	let items = $state<PlatformMerchantSummary[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let status = $state('')
	let search = $state('')
	let page = $state(1)

	let createOpen = $state(false)
	let creating = $state(false)
	let fName = $state('')
	let fSlug = $state('')
	let slugTouched = $state(false)
	let fEmail = $state('')
	let fPhone = $state('')
	let fCurrency = $state('USD')
	let fOwnerName = $state('')
	let fOwnerEmail = $state('')
	let fOwnerPassword = $state('')

	function slugify(s: string) {
		return s
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 100)
	}

	$effect(() => {
		if (!slugTouched) fSlug = slugify(fName)
	})

	function openCreate() {
		fName = ''
		fSlug = ''
		slugTouched = false
		fEmail = ''
		fPhone = ''
		fCurrency = 'USD'
		fOwnerName = ''
		fOwnerEmail = ''
		fOwnerPassword = ''
		createOpen = true
	}

	async function submitCreate() {
		if (!fName.trim() || !fSlug.trim() || !fEmail.trim() || !fOwnerName.trim() || !fOwnerEmail.trim() || fOwnerPassword.length < 10) {
			toast.error('Fill all required fields (owner password min 10 chars)')
			return
		}
		creating = true
		try {
			const res = await platformApi.createMerchant({
				name: fName.trim(),
				slug: fSlug.trim().toLowerCase(),
				email: fEmail.trim(),
				phone: fPhone.trim() || undefined,
				currency: fCurrency.trim().toUpperCase() || undefined,
				owner: { name: fOwnerName.trim(), email: fOwnerEmail.trim(), password: fOwnerPassword }
			})
			toast.success(`Merchant ${res.merchant.slug} created — owner can sign in now`)
			createOpen = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			creating = false
		}
	}

	async function load() {
		loading = true
		try {
			const res = await platformApi.listMerchants({ page, limit: 20, status: status || undefined, search: search || undefined })
			items = res.items
			meta = res.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}

	function clearFilters() {
		status = ''
		search = ''
		applyFilters()
	}
</script>

<svelte:head>
	<title>Merchants — JamiCore Admin</title>
</svelte:head>

<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
	<div>
		<h1 class="text-3xl font-bold tracking-tight text-on-surface">Merchants</h1>
		<p class="mt-1 text-sm text-secondary">{meta.total} stores on the platform</p>
	</div>
	<Button size="sm" onclick={openCreate}><Icon name="add" size="text-[16px]" /> New merchant</Button>
</div>

<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
	<div class="flex flex-wrap items-center gap-2">
		<select class="field w-auto" bind:value={status} onchange={applyFilters}>
			<option value="">All statuses</option>
			{#each MERCHANT_STATUSES as s (s)}
				<option value={s}>{s}</option>
			{/each}
		</select>
		<input
			class="field min-w-52"
			type="search"
			placeholder="Search by name"
			bind:value={search}
			onkeydown={(e) => e.key === 'Enter' && applyFilters()}
		/>
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded p-2 text-sm font-medium text-secondary hover:bg-surface-container hover:text-on-surface"
			onclick={clearFilters}
		>
			<Icon name="filter_alt_off" size="text-[16px]" />
			Clear
		</button>
	</div>
</div>

<Card padded={false}>
	{#if loading}
		<div class="space-y-2 p-5">
			{#each Array(6) as _}
				<div class="h-14 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if items.length === 0}
		<div class="flex flex-col items-center gap-2 py-16 text-center">
			<Icon name="storefront" size="text-[32px]" class="text-outline" />
			<p class="text-sm text-secondary">No merchants match.</p>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
					<tr>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Store</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Email</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Currency</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Timezone</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Modules</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-outline-variant/60">
					{#each items as m (m.id)}
						<tr class="cursor-pointer transition-colors hover:bg-surface-container-low" onclick={() => goto(`/platform/merchants/${m.id}`)}>
							<td class="px-table-cell-x py-table-cell-y">
								<span class="font-medium text-on-surface">{m.name}</span>
								<span class="block text-xs text-outline">/{m.slug}</span>
							</td>
							<td class="px-table-cell-x py-table-cell-y"><Badge label={m.status} /></td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{m.email}</td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{m.currency}</td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{m.timezone}</td>
							<td class="whitespace-nowrap px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(m.createdAt)}</td>
							<td class="whitespace-nowrap px-table-cell-x py-table-cell-y">
								<a
									href={`/platform/merchants/${m.id}#modules`}
									class="font-medium text-primary hover:underline"
									onclick={(e) => e.stopPropagation()}
								>
									Manage
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<Pagination {meta} {onPage} />
	{/if}
</Card>

{#if createOpen}
	<Modal title="New merchant" open={true} width="md" onClose={() => (createOpen = false)}>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault()
				submitCreate()
			}}
		>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="nm-name" class="field-label">Store name *</label>
					<input id="nm-name" class="field" bind:value={fName} required placeholder="Acme Corp" />
				</div>
				<div>
					<label for="nm-slug" class="field-label">Slug *</label>
					<input
						id="nm-slug"
						class="field font-mono"
						bind:value={fSlug}
						oninput={() => (slugTouched = true)}
						required
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
						placeholder="acme-corp"
					/>
				</div>
				<div>
					<label for="nm-email" class="field-label">Contact email *</label>
					<input id="nm-email" type="email" class="field" bind:value={fEmail} required />
				</div>
				<div>
					<label for="nm-phone" class="field-label">Phone</label>
					<input id="nm-phone" class="field" bind:value={fPhone} />
				</div>
				<div>
					<label for="nm-currency" class="field-label">Currency</label>
					<input id="nm-currency" class="field uppercase" bind:value={fCurrency} maxlength="10" placeholder="USD" />
				</div>
			</div>
			<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
				<p class="field-label mb-2">Owner login</p>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="sm:col-span-2">
						<label for="nm-owner-name" class="field-label">Owner name *</label>
						<input id="nm-owner-name" class="field" bind:value={fOwnerName} required />
					</div>
					<div>
						<label for="nm-owner-email" class="field-label">Owner email *</label>
						<input id="nm-owner-email" type="email" class="field" bind:value={fOwnerEmail} required />
					</div>
					<div>
						<label for="nm-owner-password" class="field-label">Owner password (min 10) *</label>
						<input id="nm-owner-password" type="password" class="field" bind:value={fOwnerPassword} required minlength={10} autocomplete="new-password" />
					</div>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" loading={creating}>Create merchant</Button>
			</div>
		</form>
	</Modal>
{/if}