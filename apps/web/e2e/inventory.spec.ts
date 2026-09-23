import { test, expect } from '@playwright/test'

test.describe('Inventory end-to-end', () => {
	test('adjusts stock through the UI and persists after reload', async ({ page }) => {
		await page.goto('/inventory')
		const adjust = page.getByRole('button', { name: /^adjust$/i }).first()
		await expect(adjust).toBeVisible({ timeout: 20_000 })

		// Current stock shown in the modal
		await adjust.click()
		const currentText = await page.getByText(/current stock:/i).textContent()
		const beforeQty = Number((currentText?.match(/(\d+)/) ?? ['0', '0'])[1])

		await page.getByLabel(/change/i).fill('3')
		await page.getByRole('dialog').getByRole('button', { name: /^apply$/i }).click()
		await expect(page.getByText(/inventory adjusted/i)).toBeVisible({ timeout: 20_000 })

		// Persists after reload
		await page.reload()
		const adjustAgain = page.getByRole('button', { name: /^adjust$/i }).first()
		await expect(adjustAgain).toBeVisible({ timeout: 20_000 })
		await adjustAgain.click()
		const afterText = await page.getByText(/current stock:/i).textContent()
		const afterQty = Number((afterText?.match(/(\d+)/) ?? ['0', '0'])[1])
		expect(afterQty).toBe(beforeQty + 3)
	})

	test('out-of-stock state is visible', async ({ page }) => {
		await page.goto('/inventory')
		await expect(page.getByText(/out.of.stock/i).first()).toBeVisible({ timeout: 20_000 })
	})
})
