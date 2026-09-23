-- Bilingual product search: include Arabic name/description in the tsvector
-- (arabic is a built-in Postgres text-search configuration).
ALTER TABLE "products" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("name", '') || ' ' || coalesce("sku", '') || ' ' || coalesce("description", ''))
    || to_tsvector('arabic', coalesce("name_ar", '') || ' ' || coalesce("description_ar", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "products_search_idx" ON "products" USING gin ("search_vector");
