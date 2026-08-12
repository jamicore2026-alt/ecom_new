<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import type { Category } from '$lib/types'

	let { categories, onClose, onSaved } = $props<{
		categories: Category[]
		onClose: () => void
		onSaved: () => void
	}>()

	let saving = $state(false)
	let fieldErrors = $state<Record<string, string>>({})

	let name = $state('')
	let parentId = $state('')
	let sortOrder = $state('0')
	let status = $state('active')
	let image = $state('')
	let editing: Category | null = null

	function startEdit(c: Category) {
		editing = c
		name = c.name
		parentId = c.parentId ?? ''
		sortOrder = String(c.sortOrder)
		status = c.status
		image = c.image ?? ''
	}

	function reset() {
		editing = null
		name = ''
		parentId = ''
		sortOrder = '0'
		status = 'active'
		image = ''
	}

	async function submit() {
		saving = true
		fieldErrors = {}
		try {
			const body: Record<string, unknown> = {
				name,
				parentId: parentId || null,
				sortOrder: Number(sortOrder || 0),
				status,
				image: image || undefined
			}
			if (editing) {
				await api.put<{ success: boolean }>(`/api/categories/${editing.id}`, body)
				toast.success('Category updated')
			} else {
				await api.post<{ success: boolean }>('/api/categories', body)
				toast.success('Category created')
			}
			reset()
			onSaved()
		} catch (e) {
			const err = e as { message?: string; fields?: Array<{ path: string; message: string }> }
			toast.error(err.message ?? 'Save failed')
			if (err.fields) {
				for (const f of err.fields) fieldErrors[f.path] = f.message
			}
		} finally {
			saving = false
		}
	}

	async function remove(c: Category) {
		if (!confirm(`Delete category "${c.name}"? Products will be uncategorized.`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/categories/${c.id}`)
			toast.success('Category deleted')
			onSaved()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function flatten(list: Category[], depth = 0): Array<Category & { depth: number }> {
		return list.flatMap((c) => [{ ...c, depth }, ...flatten(c.children ?? [], depth + 1)])
	}
</script>

<Modal title="Categories" open={true} width="md" onClose={onClose}>
	<div class="space-y-5">
		<form
			class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
			onsubmit={(e) => {
				e.preventDefault()
				submit()
			}}
		>
			<h3 class="text-sm font-semibold text-gray-800">{editing ? 'Edit category' : 'New category'}</h3>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Name *</label>
					<input class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={name} required />
					{#if fieldErrors.name}<p class="mt-1 text-xs text-red-600">{fieldErrors.name}</p>{/if}
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Parent</label>
					<select class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={parentId}>
						<option value="">None (top level)</option>
						{#each flatten(categories) as c (c.id)}
							{#if c.id !== editing?.id}
								<option value={c.id}>{'—'.repeat(c.depth + 1)} {c.name}</option>
							{/if}
						{/each}
					</select>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Sort order</label>
					<input type="number" class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={sortOrder} />
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Status</label>
					<select class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={status}>
						<option value="active">Active</option>
						<option value="archived">Archived</option>
					</select>
				</div>
			</div>
			<div class="flex items-center justify-between">
				<button type="button" class="text-xs font-medium text-gray-500 hover:text-gray-700" onclick={reset}>
					Clear form
				</button>
				<div class="flex gap-2">
					<Button variant="secondary" type="button" onclick={reset}>Reset</Button>
					<Button type="submit" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
				</div>
			</div>
		</form>

		<ul class="space-y-1">
			{#each flatten(categories) as c (c.id)}
				<li class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2" style="margin-left:{c.depth * 12}px">
					<span class="min-w-0 flex-1 text-sm text-gray-800">
						<span class="font-medium">{c.name}</span>
						{#if c.status !== 'active'}
							<span class="ml-1 text-xs text-gray-400">({c.status})</span>
						{/if}
					</span>
					<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => startEdit(c)}>Edit</button>
					<button class="text-xs font-medium text-red-600 hover:text-red-800" onclick={() => remove(c)}>Delete</button>
				</li>
			{/each}
			{#if categories.length === 0}
				<li class="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">
					No categories yet.
				</li>
			{/if}
		</ul>
	</div>
</Modal>
