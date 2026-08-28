CREATE TABLE "menu_item_modifiers" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"menu_item_id" varchar(30) NOT NULL,
	"modifier_group_id" varchar(30) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item_outlets" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"menu_item_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30) NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"price_adjustment" numeric(12, 3) DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"product_id" varchar(30) NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"preparation_time_min" integer DEFAULT 0 NOT NULL,
	"kitchen_station" varchar(100),
	"dietary_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_rate" numeric(6, 3) DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"availability" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(120) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"min_selections" integer DEFAULT 0 NOT NULL,
	"max_selections" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"modifier_group_id" varchar(30) NOT NULL,
	"name" varchar(120) NOT NULL,
	"price_adjustment" numeric(12, 3) DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu_item_modifiers" ADD CONSTRAINT "menu_item_modifiers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifiers" ADD CONSTRAINT "menu_item_modifiers_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifiers" ADD CONSTRAINT "menu_item_modifiers_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_outlets" ADD CONSTRAINT "menu_item_outlets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_outlets" ADD CONSTRAINT "menu_item_outlets_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_outlets" ADD CONSTRAINT "menu_item_outlets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_item_modifiers_item_group_idx" ON "menu_item_modifiers" USING btree ("menu_item_id","modifier_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_item_outlets_item_outlet_idx" ON "menu_item_outlets" USING btree ("menu_item_id","outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_merchant_product_idx" ON "menu_items" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE INDEX "menu_items_merchant_idx" ON "menu_items" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "modifier_groups_merchant_idx" ON "modifier_groups" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "modifiers_group_idx" ON "modifiers" USING btree ("modifier_group_id");--> statement-breakpoint
CREATE INDEX "modifiers_merchant_idx" ON "modifiers" USING btree ("merchant_id");