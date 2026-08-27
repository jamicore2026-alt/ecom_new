CREATE TABLE "affiliates" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"referral_code" varchar(50) NOT NULL,
	"commission_rate" numeric(5, 2) DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"secret_hash" varchar(255) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"type" varchar(50) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) DEFAULT 'email' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject" varchar(255),
	"content" text,
	"trigger_type" varchar(50),
	"trigger_delay_hours" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"clicked_count" integer DEFAULT 0 NOT NULL,
	"converted_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30),
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"recovery_code" varchar(100),
	"abandoned_at" timestamp,
	"recovered_order_id" varchar(30),
	"recovery_sent_at" timestamp,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_settings" (
	"merchant_id" varchar(30) PRIMARY KEY NOT NULL,
	"cod_enabled" boolean DEFAULT true NOT NULL,
	"cod_min_value" numeric(12, 3) DEFAULT 0 NOT NULL,
	"cod_max_value" numeric(12, 3),
	"cod_fee" numeric(12, 3) DEFAULT 0 NOT NULL,
	"serviceable_pincodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_shipping_days" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cod_rules" (
	"merchant_id" varchar(30) PRIMARY KEY NOT NULL,
	"serviceable_pincodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blacklist_pincodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_order_value" numeric(12, 3) DEFAULT 0 NOT NULL,
	"max_order_value" numeric(12, 3),
	"cod_fee" numeric(12, 3) DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"meta_title" varchar(255),
	"meta_description" varchar(500),
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"address_type" varchar(20) DEFAULT 'both' NOT NULL,
	"label" varchar(100) DEFAULT 'default' NOT NULL,
	"name" varchar(255),
	"company" varchar(255),
	"line1" varchar(255) DEFAULT '' NOT NULL,
	"line2" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"postal_code" varchar(20),
	"country" varchar(3) DEFAULT '' NOT NULL,
	"phone" varchar(50),
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_segments" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_tags" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"tag" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"order_id" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'unfulfilled' NOT NULL,
	"carrier" varchar(100),
	"courier_provider" varchar(50),
	"tracking_number" varchar(255),
	"tracking_url" varchar(1024),
	"label_url" varchar(1024),
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"order_id" varchar(30) NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"invoice_type" varchar(20) DEFAULT 'invoice' NOT NULL,
	"status" varchar(20) DEFAULT 'issued' NOT NULL,
	"subtotal" numeric(12, 3) DEFAULT 0 NOT NULL,
	"discount_total" numeric(12, 3) DEFAULT 0 NOT NULL,
	"shipping_total" numeric(12, 3) DEFAULT 0 NOT NULL,
	"tax_total" numeric(12, 3) DEFAULT 0 NOT NULL,
	"total" numeric(12, 3) DEFAULT 0 NOT NULL,
	"gstin" varchar(50),
	"hsn_codes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pdf_url" varchar(1024),
	"invoice_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_accounts" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"tier" varchar(30) DEFAULT 'standard' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"type" varchar(20) NOT NULL,
	"points" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference" varchar(255),
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"affiliate_id" varchar(30) NOT NULL,
	"customer_id" varchar(30),
	"order_id" varchar(30),
	"conversion_status" varchar(20) DEFAULT 'clicked' NOT NULL,
	"commission_amount" numeric(12, 3) DEFAULT 0 NOT NULL,
	"commission_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"source" varchar(20) DEFAULT 'click' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"from_warehouse_id" varchar(30) NOT NULL,
	"to_warehouse_id" varchar(30) NOT NULL,
	"variant_id" varchar(30) NOT NULL,
	"quantity" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "theme_configs" (
	"merchant_id" varchar(30) PRIMARY KEY NOT NULL,
	"primary_color" varchar(20) DEFAULT '#4f46e5' NOT NULL,
	"secondary_color" varchar(20) DEFAULT '#6b7280' NOT NULL,
	"accent_color" varchar(20) DEFAULT '#f59e0b' NOT NULL,
	"logo" varchar(1024),
	"typography" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"header" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"footer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"type" varchar(30) DEFAULT 'email_verification' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_inventory" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"warehouse_id" varchar(30) NOT NULL,
	"variant_id" varchar(30) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"endpoint_id" varchar(30) NOT NULL,
	"event" varchar(50) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature" varchar(255),
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"response_code" integer,
	"response_body" text,
	"last_error" text,
	"next_retry_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"secret" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_recovered_order_id_orders_id_fk" FOREIGN KEY ("recovered_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_settings" ADD CONSTRAINT "checkout_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_rules" ADD CONSTRAINT "cod_rules_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_segments" ADD CONSTRAINT "customer_segments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_configs" ADD CONSTRAINT "theme_configs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "warehouse_inventory_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "warehouse_inventory_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "warehouse_inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_merchant_code_idx" ON "affiliates" USING btree ("merchant_id","referral_code");--> statement-breakpoint
CREATE INDEX "api_keys_merchant_idx" ON "api_keys" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "background_jobs_merchant_type_idx" ON "background_jobs" USING btree ("merchant_id","type");--> statement-breakpoint
CREATE INDEX "background_jobs_status_retry_idx" ON "background_jobs" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "background_jobs_locked_idx" ON "background_jobs" USING btree ("locked_until");--> statement-breakpoint
CREATE INDEX "campaigns_merchant_status_idx" ON "campaigns" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_merchant_code_idx" ON "carriers" USING btree ("merchant_id","code");--> statement-breakpoint
CREATE INDEX "carts_merchant_status_idx" ON "carts" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "carts_customer_idx" ON "carts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "carts_abandoned_idx" ON "carts" USING btree ("abandoned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_merchant_slug_idx" ON "content_pages" USING btree ("merchant_id","slug");--> statement-breakpoint
CREATE INDEX "customer_addresses_merchant_customer_idx" ON "customer_addresses" USING btree ("merchant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_segments_merchant_idx" ON "customer_segments" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tags_merchant_customer_tag_idx" ON "customer_tags" USING btree ("merchant_id","customer_id","tag");--> statement-breakpoint
CREATE INDEX "fulfillments_merchant_order_idx" ON "fulfillments" USING btree ("merchant_id","order_id");--> statement-breakpoint
CREATE INDEX "fulfillments_status_idx" ON "fulfillments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_merchant_number_idx" ON "invoices" USING btree ("merchant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_merchant_idx" ON "invoices" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_accounts_merchant_customer_idx" ON "loyalty_accounts" USING btree ("merchant_id","customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_merchant_customer_idx" ON "loyalty_ledger" USING btree ("merchant_id","customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer_idx" ON "loyalty_ledger" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_merchant_customer_idx" ON "password_reset_tokens" USING btree ("merchant_id","customer_id");--> statement-breakpoint
CREATE INDEX "referrals_merchant_affiliate_idx" ON "referrals" USING btree ("merchant_id","affiliate_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_merchant_idx" ON "stock_transfers" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "verification_tokens_merchant_customer_idx" ON "verification_tokens" USING btree ("merchant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_inventory_warehouse_variant_idx" ON "warehouse_inventory" USING btree ("warehouse_id","variant_id");--> statement-breakpoint
CREATE INDEX "warehouse_inventory_merchant_idx" ON "warehouse_inventory" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_merchant_code_idx" ON "warehouses" USING btree ("merchant_id","code");--> statement-breakpoint
CREATE INDEX "warehouses_merchant_idx" ON "warehouses" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_merchant_status_idx" ON "webhook_deliveries" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_merchant_idx" ON "webhook_endpoints" USING btree ("merchant_id");