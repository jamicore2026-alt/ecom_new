-- Phase 6 catalog merchandising: sale windows, scheduled publishing,
-- tags/weight/GTIN/SEO on products, category descriptions.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_starts_at" timestamptz;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_ends_at" timestamptz;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "publish_at" timestamptz;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight" numeric;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gtin" varchar(32);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "meta_title" varchar(255);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "meta_description" text;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "description" text;
CREATE INDEX IF NOT EXISTS "products_publish_idx" ON "products" ("merchant_id", "publish_at");
