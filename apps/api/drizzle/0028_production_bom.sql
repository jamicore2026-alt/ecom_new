CREATE TABLE "bill_of_materials" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"output_variant_id" varchar(30) NOT NULL,
	"output_quantity" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_items" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"bom_id" varchar(30) NOT NULL,
	"variant_id" varchar(30) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_order_items" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"production_order_id" varchar(30) NOT NULL,
	"variant_id" varchar(30) NOT NULL,
	"change" integer NOT NULL,
	"before_value" integer NOT NULL,
	"after_value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"production_number" varchar(50) NOT NULL,
	"bom_id" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_output_variant_id_product_variants_id_fk" FOREIGN KEY ("output_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_bill_of_materials_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bill_of_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_id_bill_of_materials_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bill_of_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_merchant_idx" ON "bill_of_materials" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "bom_output_variant_idx" ON "bill_of_materials" USING btree ("output_variant_id");--> statement-breakpoint
CREATE INDEX "bom_items_bom_idx" ON "bom_items" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_items_variant_idx" ON "bom_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "production_order_items_order_idx" ON "production_order_items" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "production_order_items_variant_idx" ON "production_order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_merchant_number_idx" ON "production_orders" USING btree ("merchant_id","production_number");--> statement-breakpoint
CREATE INDEX "production_orders_merchant_idx" ON "production_orders" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "production_orders_bom_idx" ON "production_orders" USING btree ("bom_id");