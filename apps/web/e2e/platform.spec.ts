import { test, expect } from '@playwright/test'

const ADMIN_CREDS = [
	{ email: process.env.E2E_PLATFORM_EMAIL ?? 'owner@jamicore.com', password: process.env.E2E_PLATFORM_PASSWORD ?? 'password123' },
	// Fallback: API test suite seeds this admin (see platform-admin.test.ts).
	{ email: 'ops@jamicore.com', password: 'Ops-Password-123' }
]

test.describe('Platform admin', () => {
	test('redirects unauthenticated merchants page to platform login', async ({ page }) => {
		await page.goto('/platform/merchants')
		await expect(page).toHaveURL(/\/platform\/login/)
	})

	test('logs in, lists merchants and manages admins without enabling MFA', async ({ page }) => {
		await page.goto('/platform/login')
		let signedIn = false
		for (const creds of ADMIN_CREDS) {
			await page.getByLabel(/email/i).fill(creds.email)
			await page.getByLabel(/password/i).fill(creds.password)
			await page.getByRole('button', { name: /sign in/i }).click()
			try {
				await expect(page).toHaveURL(/\/platform\/merchants/, { timeout: 8000 })
				signedIn = true
				break
			} catch {
				// try next credential pair
			}
		}
		expect(signedIn).toBe(true)
		await expect(page.getByRole('heading', { name: /merchants/i })).toBeVisible()

		// Admins page: list + MFA card render (never enrolls on the shared seed admin).
		await page.goto('/platform/admins')
		await expect(page.getByRole('heading', { name: /platform admins/i })).toBeVisible()
		await expect(page.getByText(/two-factor authentication/i)).toBeVisible()
	})
})
