<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { platformApi } from '$lib/platform-api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'

	let email = $state('')
	let password = $state('')
	let loading = $state(false)
	let hydrated = $state(false)
	let fieldErrors = $state<Record<string, string>>({})

	onMount(() => {
		hydrated = true
	})

	async function submit() {
		loading = true
		fieldErrors = {}
		try {
			await platformApi.login(email, password)
			toast.success('Signed in')
			goto('/platform/merchants')
		} catch (e) {
			const err = e as { message?: string; fields?: Array<{ path: string; message: string }> }
			toast.error(err.message ?? 'Sign-in failed')
			if (err.fields) {
				for (const f of err.fields) fieldErrors[f.path] = f.message
			}
		} finally {
			loading = false
		}
	}
</script>

<svelte:head>
	<title>Admin sign in — JamiCore</title>
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded bg-primary-container text-on-primary-container">
				<Icon name="admin_panel_settings" size="text-[24px]" />
			</div>
			<h1 class="text-2xl font-bold tracking-tight text-on-surface">JamiCore Admin</h1>
			<p class="mt-1 text-sm text-secondary">Platform access only — use the dashboard for store work.</p>
		</div>

		<form
			class="rounded border border-outline-variant bg-surface-container-lowest p-6"
			onsubmit={(e) => {
				e.preventDefault()
				submit()
			}}
		>
			<div class="space-y-4">
				<div>
					<label class="mb-1 block text-sm font-medium text-on-surface" for="email">Email</label>
					<input
						id="email"
						type="email"
						required
						bind:value={email}
						class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-secondary focus:outline-2 focus:outline-primary"
						placeholder="ops@jamicore.com"
					/>
					{#if fieldErrors.email}
						<p class="mt-1 text-xs text-error">{fieldErrors.email}</p>
					{/if}
				</div>

				<div>
					<label class="mb-1 block text-sm font-medium text-on-surface" for="password">Password</label>
					<input
						id="password"
						type="password"
						required
						bind:value={password}
						class="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-secondary focus:outline-2 focus:outline-primary"
						placeholder="••••••••"
					/>
					{#if fieldErrors.password}
						<p class="mt-1 text-xs text-error">{fieldErrors.password}</p>
					{/if}
				</div>
			</div>

			<Button type="submit" class="mt-6 w-full" loading={loading} disabled={loading || !hydrated}>
				Sign in
			</Button>
		</form>
	</div>
</div>