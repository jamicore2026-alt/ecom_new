CREATE TABLE "invoice_settings" (
	"merchant_id" varchar(30) PRIMARY KEY NOT NULL,
	"prefix" varchar(50) DEFAULT 'INV' NOT NULL,
	"logo" varchar(1024),
	"business_name" varchar(255),
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"tax_label" varchar(100),
	"tax_number" varchar(100),
	"header_note" text,
	"footer_note" text,
	"display_fields" jsonb DEFAULT '{"columns":[],"showDiscount":true,"showTax":true}'::jsonb NOT NULL,
	"layout" varchar(20) DEFAULT 'standard' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"option_id" varchar(30) NOT NULL,
	"value" varchar(100) NOT NULL,
	"value_ar" varchar(100),
	"price_adjustment" numeric(12, 3) DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"product_id" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"name_ar" varchar(100),
	"type" varchar(20) DEFAULT 'radio' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"min_selections" integer DEFAULT 1 NOT NULL,
	"max_selections" integer DEFAULT 1 NOT NULL,
	"allow_control" jsonb DEFAULT '{"perValueQuantity":false,"unlimited":false}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "name_ar" varchar(255);--> statement-breakpoint
ALTER TABLE "checkout_settings" ADD COLUMN "required_fields" jsonb DEFAULT '{"phone":true,"name":true,"line1":true,"line2":true,"city":true,"state":true,"postalCode":true,"country":true,"email":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" varchar(10) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "country" varchar(3);--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD COLUMN "name_ar" varchar(120);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "option_values_ar" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "name_ar" varchar(255);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description_ar" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "visibility" varchar(20) DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_settings" ADD COLUMN "rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "kind" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "group_key" varchar(64);--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_product_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_option_values_option_idx" ON "product_option_values" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "product_options_product_idx" ON "product_options" USING btree ("product_id");--> statement-breakpoint

-- RLS equivalents of 0029_enable_rls.sql for the new merchant-scoped tables.
-- Queries must set app.current_merchant_id or they return zero rows.
ALTER TABLE "product_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_options" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_options' AND policyname = 'rls_product_options') THEN
    CREATE POLICY "rls_product_options" ON "product_options"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "product_option_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_option_values" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_option_values' AND policyname = 'rls_product_option_values') THEN
    CREATE POLICY "rls_product_option_values" ON "product_option_values"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "invoice_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invoice_settings' AND policyname = 'rls_invoice_settings') THEN
    CREATE POLICY "rls_invoice_settings" ON "invoice_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;