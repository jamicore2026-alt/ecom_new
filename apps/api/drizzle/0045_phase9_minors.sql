-- Phase 9 minors: audit hash chain, theme/content versions, bundles, transfer docs.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "prev_hash" varchar(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "row_hash" varchar(64);
CREATE TABLE IF NOT EXISTS "theme_versions" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}',
  "note" varchar(255),
  "created_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "theme_versions_merchant_version_idx" ON "theme_versions" ("merchant_id", "version");
CREATE INDEX IF NOT EXISTS "theme_versions_merchant_idx" ON "theme_versions" ("merchant_id");
CREATE TABLE IF NOT EXISTS "product_bundles" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "name_ar" varchar(255),
  "price" numeric NOT NULL DEFAULT 0,
  "compare_at_price" numeric,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "product_bundles_merchant_idx" ON "product_bundles" ("merchant_id");
CREATE TABLE IF NOT EXISTS "product_bundle_items" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "bundle_id" varchar(30) NOT NULL REFERENCES "product_bundles"("id") ON DELETE CASCADE,
  "variant_id" varchar(30) NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bundle_items_bundle_variant_idx" ON "product_bundle_items" ("bundle_id", "variant_id");
CREATE INDEX IF NOT EXISTS "bundle_items_bundle_idx" ON "product_bundle_items" ("bundle_id");
CREATE TABLE IF NOT EXISTS "product_relations" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "product_id" varchar(30) NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "related_product_id" varchar(30) NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "relation_type" varchar(20) NOT NULL DEFAULT 'related',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "product_relations_unique_idx" ON "product_relations" ("product_id", "related_product_id", "relation_type");
CREATE INDEX IF NOT EXISTS "product_relations_product_idx" ON "product_relations" ("product_id");
CREATE TABLE IF NOT EXISTS "content_versions" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "content_id" varchar(30) NOT NULL REFERENCES "content_pages"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "created_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "content_versions_content_version_idx" ON "content_versions" ("content_id", "version");
CREATE INDEX IF NOT EXISTS "content_versions_content_idx" ON "content_versions" ("content_id");
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "reason_code" varchar(30);
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "carrier" varchar(100);
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "tracking_number" varchar(255);
