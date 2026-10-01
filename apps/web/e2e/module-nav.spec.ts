import { test, expect } from '@playwright/test'

test.describe('Module app-switcher (Customers pilot)', () => {
	test('launcher filters the sidebar to the Customers module', async ({ page }) => {
		await page.goto('/dashboard')
		const sidebar = page.getByRole('navigation', { name: /main navigation/i })
		await expect(sidebar.getByRole('link', { name: /^products$/i })).toBeVisible()

		// Open the launcher from the header grid button.
		await page.getByRole('button', { name: /switch module/i }).click()
		const dialog = page.getByRole('dialog', { name: /switch module/i })
		await expect(dialog).toBeVisible()
		await dialog.getByRole('button', { name: /customers/i }).click()

		// Sidebar now shows only the 4 module items (+ pinned daily items).
		await expect(page).toHaveURL(/\/(segments|loyalty|reviews|affiliates)/)
		for (const name of [/^segments$/i, /^loyalty$/i, /^reviews$/i, /^affiliates$/i]) {
			await expect(sidebar.getByRole('link', { name })).toBeVisible()
		}
		await expect(sidebar.getByRole('link', { name: /^products$/i })).toBeHidden()
		// Daily-use items stay one click away.
		await expect(sidebar.getByRole('link', { name: /^orders$/i })).toBeVisible()

		// Back to the full sidebar.
		await sidebar.getByRole('button', { name: /all items/i }).click()
		await expect(sidebar.getByRole('link', { name: /^products$/i })).toBeVisible()
	})
})
