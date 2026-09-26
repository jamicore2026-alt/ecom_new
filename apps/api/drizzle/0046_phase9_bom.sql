-- Phase 9: BOM revisions + scrap/yield.
ALTER TABLE "bill_of_materials" ADD COLUMN IF NOT EXISTS "revision_of" varchar(30);
ALTER TABLE "bill_of_materials" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "bill_of_materials" ADD COLUMN IF NOT EXISTS "scrap_percent" numeric NOT NULL DEFAULT 0;
ALTER TABLE "bill_of_materials" ADD COLUMN IF NOT EXISTS "yield_percent" numeric NOT NULL DEFAULT 100;
