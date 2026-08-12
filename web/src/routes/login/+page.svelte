<script lang="ts">
	import { goto } from '$app/navigation'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'

	let email = $state('')
	let password = $state('')
	let merchantSlug = $state('')
	let showSlug = $state(false)
	let loading = $state(false)
	let fieldErrors = $state<Record<string, string>>({})

	async function submit() {
		loading = true
		fieldErrors = {}
		try {
			await session.login({ email, password, ...(showSlug && merchantSlug ? { merchantSlug } : {}) })
			toast.success('Signed in successfully')
			goto('/dashboard')
		} catch (e) {
			const err = e as { message?: string; fields?: Array<{ path: string; message: string }> }
			toast.error(err.message ?? 'Login failed')
			if (err.fields) {
				for (const f of err.fields) fieldErrors[f.path] = f.message
			}
		} finally {
			loading = false
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
				S
			</div>
			<h1 class="text-xl font-bold text-gray-900">Merchant Dashboard</h1>
			<p class="mt-1 text-sm text-gray-500">Sign in to manage your store</p>
		</div>

		<form
			class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
			onsubmit={(e) => {
				e.preventDefault()
				submit()
			}}
		>
			<div class="space-y-4">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700" for="email">Email</label>
					<input
						id="email"
						type="email"
						required
						bind:value={email}
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
						placeholder="owner@acme.com"
					/>
					{#if fieldErrors.email}
						<p class="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
					{/if}
				</div>

				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700" for="password">Password</label>
					<input
						id="password"
						type="password"
						required
						bind:value={password}
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
						placeholder="••••••••"
					/>
					{#if fieldErrors.password}
						<p class="mt-1 text-xs text-red-600">{fieldErrors.password}</p>
					{/if}
				</div>

				<div>
					<div class="flex items-center justify-between">
						<label class="text-sm font-medium text-gray-700" for="merchantSlug">Merchant slug</label>
						<button
							type="button"
							class="text-xs font-medium text-indigo-600 hover:text-indigo-700"
							onclick={() => (showSlug = !showSlug)}
						>
							{showSlug ? 'Hide' : 'Optional'}
						</button>
					</div>
					{#if showSlug}
						<input
							id="merchantSlug"
							type="text"
							bind:value={merchantSlug}
							class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
							placeholder="acme-store"
						/>
						<p class="mt-1 text-xs text-gray-500">Required when multiple stores exist.</p>
					{/if}
				</div>
			</div>

			<Button type="submit" class="mt-6 w-full" loading={loading} disabled={loading}>
				Sign in
			</Button>
		</form>

		<p class="mt-6 text-center text-xs text-gray-400">
			Demo: owner@acme.com / password123
		</p>
	</div>
</div>
