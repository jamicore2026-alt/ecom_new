CREATE TABLE "payment_provider_configs" (
	"merchant_id" varchar(30) NOT NULL,
	"provider" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" varchar(10) DEFAULT 'test' NOT NULL,
	"country" varchar(5),
	"credentials" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_configs_merchant_id_provider_pk" PRIMARY KEY("merchant_id","provider")
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"order_id" varchar(30) NOT NULL,
	"provider" varchar(30) NOT NULL,
	"provider_ref" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"amount" numeric(12, 3) DEFAULT 0 NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"provider" varchar(30) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"payload" jsonb,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "value" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "min_subtotal" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "total_spent" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "price" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "total" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "subtotal" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "shipping_total" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_total" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "tax_total" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "total" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "price" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "compare_at_price" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "compare_at_price" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "cost" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "discount_percent" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "returns" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "shipping_settings" ALTER COLUMN "free_shipping_threshold" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(50);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_provider" varchar(30);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "provider_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_provider_configs" ADD CONSTRAINT "payment_provider_configs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_transactions_order_idx" ON "payment_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_ref_idx" ON "payment_transactions" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_idx" ON "webhook_events" USING btree ("provider","event_id");