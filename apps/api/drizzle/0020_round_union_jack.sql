CREATE TABLE "kitchen_stations" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30),
	"name" varchar(100) NOT NULL,
	"prep_sla_min" integer DEFAULT 10 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kitchen_ticket_items" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"ticket_id" varchar(30) NOT NULL,
	"order_item_id" varchar(30),
	"menu_item_id" varchar(30),
	"name" varchar(255) NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"ready_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kitchen_tickets" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30),
	"order_id" varchar(30) NOT NULL,
	"order_number" varchar(40) NOT NULL,
	"station_id" varchar(30) NOT NULL,
	"station_name" varchar(100) NOT NULL,
	"source_type" varchar(20) DEFAULT 'DINE_IN' NOT NULL,
	"status" varchar(20) DEFAULT 'NEW' NOT NULL,
	"priority" varchar(10) DEFAULT 'NORMAL' NOT NULL,
	"prep_sla_min" integer DEFAULT 10 NOT NULL,
	"due_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"ready_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_ticket_id_kitchen_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."kitchen_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_order_item_id_food_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."food_order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_station_id_kitchen_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."kitchen_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_stations_merchant_outlet_name_idx" ON "kitchen_stations" USING btree ("merchant_id","outlet_id","name");--> statement-breakpoint
CREATE INDEX "kitchen_stations_merchant_idx" ON "kitchen_stations" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "kitchen_ticket_items_ticket_idx" ON "kitchen_ticket_items" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "kitchen_ticket_items_merchant_idx" ON "kitchen_ticket_items" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_tickets_order_station_idx" ON "kitchen_tickets" USING btree ("order_id","station_id");--> statement-breakpoint
CREATE INDEX "kitchen_tickets_merchant_status_idx" ON "kitchen_tickets" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "kitchen_tickets_station_idx" ON "kitchen_tickets" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "kitchen_tickets_merchant_idx" ON "kitchen_tickets" USING btree ("merchant_id");