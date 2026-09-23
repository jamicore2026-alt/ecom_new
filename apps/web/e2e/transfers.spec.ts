import { test, expect } from '@playwright/test'

const API = process.env.E2E_API_URL ?? 'http://localhost:3005'

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

async function adminToken() {
	const res = await fetch(API + '/api/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: 'admin@jamicore.com', password: 'password123' })
	})
	return ((await res.json()).data.accessToken as string) ?? ''
}

test.describe('Warehouse transfers end-to-end', () => {
	let srcId = ''
	let dstId = ''
	let variantId = ''

	test.beforeEach(async () => {
		const token = await adminToken()
		// Fixed E2E warehouses (created once, reused across runs)
		const existing = await api('/api/warehouses', token)
		const listed = Array.isArray(existing.data) ? existing.data : (existing.data?.items ?? [])
		const byCode = new Map(listed.map((w: any) => [w.code, w.id]))
		for (const [code, name] of [['E2E-SRC', 'E2E Source'], ['E2E-DST', 'E2E Destination']] as const) {
			if (!byCode.has(code)) {
				const created = await api('/api/warehouses', token, {
					method: 'POST',
					body: JSON.stringify({ name, code })
				})
				byCode.set(code, created.data.id)
			}
		}
		srcId = byCode.get('E2E-SRC')!
		dstId = byCode.get('E2E-DST')!

		// A stocked variant in the source warehouse
		const stamp = Date.now()
		const prod = await api('/api/products', token, {
			method: 'POST',
			body: JSON.stringify({
				sku: `E2E-TR-${stamp}`,
				name: 'E2E Transfer Product',
				price: 5,
				status: 'active',
				variants: [{ sku: `E2E-TR-${stamp}-V`, optionValues: { Size: 'M' }, inventory: 0 }]
			})
		})
		const detail = await api(`/api/products/${prod.data.id}`, token)
		variantId = detail.data.variants[0].id
		await api(`/api/warehouses/${srcId}/inventory`, token, {
			method: 'PUT',
			body: JSON.stringify({ variantId, quantity: 10 })
		})
	})

	test('creates a transfer through the UI and moves stock', async ({ page }) => {
		const token = await adminToken()
		await page.goto('/transfers')
		await page.getByRole('button', { name: /create transfer/i }).click()

		await page.locator('#tr-from').selectOption(srcId)
		await page.locator('#tr-to').selectOption(dstId)
		// First item line: pick the stocked variant, set quantity
		const modal = page.locator('form', { hasText: 'Source warehouse' })
		await modal.locator('select').nth(2).selectOption(variantId)
		await modal.getByPlaceholder('Qty').fill('4')
		await page.getByRole('dialog').getByRole('button', { name: /^create transfer$/i }).click()

		await expect(page.getByText(/transfer created/i)).toBeVisible({ timeout: 20_000 })

		// Source decreased, destination increased (real API state)
		const src = await api(`/api/warehouses/${srcId}/inventory`, token)
		const dst = await api(`/api/warehouses/${dstId}/inventory`, token)
		const qty = (list: any) => {
			const rows = Array.isArray(list.data) ? list.data : (list.data?.items ?? list.data?.inventory ?? [])
			return rows.find((r: any) => r.variantId === variantId)?.quantity ?? 0
		}
		expect(qty(src)).toBe(6)
		expect(qty(dst)).toBe(4)

		// Record survives reload
		await page.reload()
		await expect(page.getByText('E2E Source').first()).toBeVisible()
	})
})
