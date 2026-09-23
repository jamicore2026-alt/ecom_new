import { test as setup, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@jamicore.com'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password123'
const AUTH_FILE = 'e2e/.auth/admin.json'

// Real UI login (not an API shortcut) — itself an E2E assertion.
setup('authenticate as merchant admin', async ({ page }) => {
	await page.goto('/login')
	await expect(page.getByLabel(/email/i)).toBeVisible()
	await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
	await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
	await page.getByRole('button', { name: /sign in|log in/i }).click()
	// Sidebar = authenticated shell.
	await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible({ timeout: 20_000 })
	await expect(page).toHaveURL(/\/dashboard/)
	await page.context().storageState({ path: AUTH_FILE })
})

setup('rejects invalid credentials', async ({ page }) => {
	await page.goto('/login')
	await page.getByLabel(/email/i).fill('nobody@example.com')
	await page.getByLabel(/password/i).fill('wrong-password')
	await page.getByRole('button', { name: /sign in|log in/i }).click()
	await expect(page).not.toHaveURL(/\/dashboard/)
})
