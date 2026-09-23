import { test, expect } from '@playwright/test'

const API = process.env.E2E_API_URL ?? 'http://localhost:3005'

async function adminToken() {
	const res = await fetch(API + '/api/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: 'admin@jamicore.com', password: 'password123' })
	})
	return ((await res.json()).data.accessToken as string) ?? ''
}

async function api(path: string, token: string, init?: RequestInit) {
	const res = await fetch(API + path, {
		...init,
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
			...((init?.headers as Record<string, string>) ?? {})
		}
	})
	return res.json()
}

/** Remove every E2E Kuwait rule so runs stay idempotent. */
async function removeE2ERules() {
	const token = await adminToken()
	const current = await api('/api/settings/shipping', token)
	const data = current.data ?? {}
	const rules = (data.rules ?? []).filter((r: any) => r.name !== 'E2E Kuwait')
	await api('/api/settings/shipping', token, {
		method: 'PUT',
		body: JSON.stringify({
			freeShippingThreshold: data.freeShippingThreshold ?? 0,
			zones: data.zones ?? [],
			rules
		})
	})
}

test.describe('Settings end-to-end', () => {
	test.beforeEach(async () => {
		await removeE2ERules()
	})
	test.afterEach(async () => {
		await removeE2ERules()
	})

	test('shipping country rule persists after reload', async ({ page }) => {
		await page.goto('/settings')
		await page.getByRole('button', { name: /^shipping$/i }).click()

		await page.getByRole('button', { name: /add rule/i }).click()
		await page.getByPlaceholder('Rule name').last().fill('E2E Kuwait')
		// The new rule is appended last; scope all further fields to its card
		const card = page.locator('div.rounded-lg.border').last()
		await card.getByPlaceholder('Rate').fill('2.5')
		await card.locator('select').first().selectOption('country')
		await card.getByPlaceholder(/country \(e\.g\. kw\)/i).fill('KW')
		await page.getByRole('button', { name: /^save$/i }).click()
		await expect(page.getByText(/shipping settings saved/i)).toBeVisible({ timeout: 20_000 })

		await page.reload()
		await page.getByRole('button', { name: /^shipping$/i }).click()
		await expect(page.getByPlaceholder('Rule name').last()).toHaveValue('E2E Kuwait')
		await expect(page.getByPlaceholder(/country \(e\.g\. kw\)/i).last()).toHaveValue('KW')
	})
})
