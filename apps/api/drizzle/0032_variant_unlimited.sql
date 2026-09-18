ALTER TABLE "product_variants" ADD COLUMN "unlimited" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_options" ALTER COLUMN "min_selections" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "product_options" ALTER COLUMN "max_selections" SET DEFAULT 1;