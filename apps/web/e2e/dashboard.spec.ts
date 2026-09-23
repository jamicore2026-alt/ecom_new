import { test, expect } from '@playwright/test'

test.describe('Merchant dashboard home', () => {
	test('shows KPIs, quick actions, chart and recent orders', async ({ page }) => {
		await page.goto('/dashboard')
		await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible()

		// Quick actions (permission-gated) link to real routes
		const nav = page.getByRole('navigation', { name: /quick actions/i })
		await expect(nav.getByRole('link', { name: /orders/i }).first()).toHaveAttribute('href', '/orders')

		// KPI cards render values
		await expect(page.getByText(/today.s sales/i).first()).toBeVisible()

		// Revenue chart + a11y data-table fallback
		await expect(page.getByRole('img', { name: /revenue/i })).toBeVisible()
		await page.getByText(/view sales data as a table/i).click()
		await expect(page.getByRole('columnheader', { name: /revenue/i })).toBeVisible()
	})

	test('sidebar groups collapse without losing items', async ({ page }) => {
		await page.goto('/dashboard')
		const sidebar = page.getByRole('navigation', { name: /main navigation/i })
		// All six nested groups present
		for (const g of ['General', 'Catalog', 'Marketing', 'Fulfillment', 'Restaurant', 'Insights']) {
			await expect(sidebar.getByRole('button', { name: new RegExp(g, 'i') })).toBeVisible()
		}
		// Collapse Catalog → Products link hides; expand → returns
		const catalog = sidebar.getByRole('button', { name: /catalog/i })
		await expect(catalog).toHaveAttribute('aria-expanded', 'true')
		await catalog.click()
		await expect(catalog).toHaveAttribute('aria-expanded', 'false')
		await expect(sidebar.getByRole('link', { name: /^products$/i })).toBeHidden()
		await catalog.click()
		await expect(sidebar.getByRole('link', { name: /^products$/i })).toBeVisible()
		// Deep link auto-expands its group
		await page.goto('/transfers')
		await expect(sidebar.getByRole('button', { name: /catalog/i })).toHaveAttribute('aria-expanded', 'true')
	})
})
