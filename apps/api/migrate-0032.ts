import './test/load-env'
import postgres from 'postgres'

const url = process.env.APP_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) throw new Error('no DB url')
const sql = postgres(url, { max: 1 })

const has = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'unlimited'`
if (has.length === 0) {
  await sql`ALTER TABLE "product_variants" ADD COLUMN "unlimited" boolean DEFAULT false NOT NULL`
  console.log('added product_variants.unlimited')
} else {
  console.log('product_variants.unlimited already present')
}
await sql.end()