import { test, expect } from '@playwright/test'

const API = process.env.E2E_API_URL ?? 'http://localhost:3005'
const SKU = `E2E-PROD-${Date.now()}`
let productId = ''

async function api(path: string, init?: RequestInit) {
	const res = await fetch(API + path, {
		...init,
		headers: { 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) }
	})
	return res.json()
}

async function adminToken() {
	const body = await api('/api/auth/login', {
		method: 'POST',
		body: JSON.stringify({ email: 'admin@jamicore.com', password: 'password123' })
	})
	return body.data.accessToken as string
}

test.describe('Products end-to-end', () => {
	test.afterEach(async () => {
		if (productId) {
			const token = await adminToken()
			await fetch(API + `/api/products/${productId}`, {
				method: 'DELETE',
				headers: { authorization: `Bearer ${token}` }
			})
			productId = ''
		}
	})

	test('creates a product with Arabic name, sale price and visibility', async ({ page }) => {
		await page.goto('/products')
		await page.getByRole('button', { name: /new product/i }).click()

		await page.getByLabel(/name \*/i).fill('E2E Test Product')
		await page.getByLabel(/name \(arabic\)/i).fill('منتج تجريبي')
		await page.getByLabel(/^sku$/i).fill(SKU)
		await page.getByLabel(/sale price \*/i).fill('25.5')
		await page.getByLabel(/^description$/i).fill('E2E description')
		await page.getByLabel(/description \(arabic\)/i).fill('وصف تجريبي')
		await page.getByLabel(/^category$/i).selectOption({ label: 'Books' })
		await page.getByLabel(/visibility/i).selectOption('both')
		// Launch checklist requires an image: upload a 1px PNG.
		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		)
		await page.locator('input[type="file"]').first().setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: png })
		// Wait for the uploaded thumbnail (not the static hint text).
		await expect(page.getByRole('dialog').locator('img')).toBeVisible({ timeout: 20_000 })
		await page.getByRole('button', { name: /create product/i }).click()
		// Creation closes the modal; if the launch checklist blocks it, fail here loudly.
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 })

		// Appears in the list with the right price (filter to be page-independent)
		await page.getByPlaceholder(/search name or sku/i).fill(SKU)
		await page.getByPlaceholder(/search name or sku/i).press('Enter')
		await expect(page.getByRole('cell', { name: SKU })).toBeVisible({ timeout: 20_000 })

		// Persisted end-to-end: read back through the real API
		const token = await adminToken()
		const body = await api(`/api/products?search=${SKU}`, {
			headers: { authorization: `Bearer ${token}` }
		})
		expect(body.data.meta.total).toBeGreaterThanOrEqual(1)
		const created = body.data.items[0]
		productId = created.id
		expect(created.nameAr).toBe('منتج تجريبي')
		expect(created.descriptionAr).toBe('وصف تجريبي')
		expect(Number(created.price)).toBe(25.5)
		expect(created.visibility).toBe('both')

		// Survives reload
		await page.reload()
		await page.getByPlaceholder(/search name or sku/i).fill(SKU)
		await page.getByPlaceholder(/search name or sku/i).press('Enter')
		await expect(page.getByRole('cell', { name: SKU })).toBeVisible()
	})
})
