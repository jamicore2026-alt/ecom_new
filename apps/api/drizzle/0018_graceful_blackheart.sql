CREATE TABLE "food_order_items" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"order_id" varchar(30) NOT NULL,
	"menu_item_id" varchar(30),
	"product_id" varchar(30),
	"variant_id" varchar(30),
	"name" varchar(255) NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_price" numeric(12, 3) DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total" numeric(12, 3) DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_type" varchar(20) DEFAULT 'ecommerce' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "outlet_id" varchar(30);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_order_items_order_idx" ON "food_order_items" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_merchant_type_status_idx" ON "orders" USING btree ("merchant_id","order_type","status");--> statement-breakpoint
CREATE INDEX "orders_outlet_idx" ON "orders" USING btree ("outlet_id");