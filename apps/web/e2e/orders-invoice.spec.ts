import { test, expect } from '@playwright/test'

test.describe('Orders + invoice PDF end-to-end', () => {
	test('lists orders, opens one, generates and downloads a real PDF', async ({ page }) => {
		await page.goto('/orders')
		const firstOrder = page.getByRole('link', { name: /^#/ }).first()
		await expect(firstOrder).toBeVisible({ timeout: 20_000 })
		await firstOrder.click()
		await expect(page).toHaveURL(/\/orders\//)

		// Ensure an invoice exists (seeded orders may not have one)
		if ((await page.getByTitle('Download PDF').count()) === 0) {
			await page.getByRole('button', { name: /generate invoice/i }).click()
			await expect(page.getByTitle('Download PDF').first()).toBeVisible({ timeout: 20_000 })
		}

		const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
		await page.getByTitle('Download PDF').first().click()
		const download = await downloadPromise
		const path = await download.path()
		expect(path).toBeTruthy()

		// Real PDF bytes, not an error page
		const { readFileSync } = await import('node:fs')
		const head = readFileSync(path!).subarray(0, 5).toString()
		expect(head).toBe('%PDF-')
	})
})
