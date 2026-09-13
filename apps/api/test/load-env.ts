import { existsSync, readFileSync } from 'fs'
import path from 'path'

/**
 * Load the repo-root .env into process.env for keys not already set.
 * Bun only auto-loads .env from cwd (apps/api); the app expects the
 * platform-wide APP_RUNTIME_DATABASE_URL / DATABASE_URL at the repo root, so
 * this must run before any app module is imported (import order in
 * global-setup.ts guarantees that).
 */
const loadRootEnv = (): void => {
  const seen = new Set<string>()
  let dir = process.cwd()
  for (let depth = 0; depth < 6 && !seen.has('.env'); depth += 1) {
    const file = path.join(dir, '.env')
    if (existsSync(file)) {
      seen.add('.env')
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
        if (m && !m[1].startsWith('#') && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
      return
    }
    dir = path.dirname(dir)
  }
}

loadRootEnv()