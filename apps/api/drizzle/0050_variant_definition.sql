-- Variant 3-screen UX: display names, selection method, bounds, button style.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "name" varchar(255);
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "name_ar" varchar(255);
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "required" boolean NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "min_selections" integer;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "max_selections" integer;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "button_style" varchar(20);
