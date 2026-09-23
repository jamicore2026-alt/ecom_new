import { defineConfig, devices } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// Minimal dotenv loader (stdlib only): root .env → process env (no overwrite).
// Guarantees the API webServer below always gets DATABASE_URL etc.,
// whether tests run locally or in CI.
const rootEnv = path.resolve(import.meta.dirname, '../../.env')
if (existsSync(rootEnv)) {
	for (const line of readFileSync(rootEnv, 'utf-8').split('\n')) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
		if (!m || process.env[m[1]] !== undefined) continue
		let v = m[2].trim()
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
		process.env[m[1]] = v
	}
}

const API_PORT = Number(process.env.PORT ?? 3005)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5478)

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1, // shared seeded DB — no parallel races
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
	use: {
		baseURL: `http://localhost:${WEB_PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'merchant',
			testMatch: /.*\.spec\.ts/,
			dependencies: ['setup'],
			use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' }
		}
	],
	webServer: [
		{
			command: 'bun src/index.ts',
			cwd: path.resolve(import.meta.dirname, '../../apps/api'),
			port: API_PORT,
			timeout: 120_000,
			reuseExistingServer: !process.env.CI,
			env: { ...process.env, PORT: String(API_PORT) }
		},
		{
			command: `bun run dev --port ${WEB_PORT}`,
			cwd: import.meta.dirname,
			port: WEB_PORT,
			timeout: 120_000,
			reuseExistingServer: !process.env.CI
		}
	]
})
