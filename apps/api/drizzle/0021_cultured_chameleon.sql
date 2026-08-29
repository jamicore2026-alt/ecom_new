CREATE TABLE "delivery_orders" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"order_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30),
	"zone_id" varchar(30),
	"status" varchar(25) DEFAULT 'UNASSIGNED' NOT NULL,
	"assigned_driver_id" varchar(30),
	"driver_name" varchar(255),
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fee" numeric(12, 3) DEFAULT 0 NOT NULL,
	"eta_min" integer DEFAULT 30 NOT NULL,
	"pickup_at" timestamp,
	"picked_up_at" timestamp,
	"arrived_at" timestamp,
	"delivered_at" timestamp,
	"cancelled_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30),
	"name" varchar(100) NOT NULL,
	"center_lat" numeric(9, 6) NOT NULL,
	"center_lng" numeric(9, 6) NOT NULL,
	"radius_km" numeric(8, 3) DEFAULT 5 NOT NULL,
	"delivery_fee" numeric(12, 3) DEFAULT 0 NOT NULL,
	"min_order" numeric(12, 3) DEFAULT 0 NOT NULL,
	"free_delivery_threshold" numeric(12, 3),
	"eta_min" integer DEFAULT 30 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_assignments" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"delivery_order_id" varchar(30) NOT NULL,
	"driver_id" varchar(30),
	"driver_name" varchar(255),
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"unassigned_at" timestamp,
	"reason" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "driver_locations" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"driver_id" varchar(30) NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"vehicle_type" varchar(50),
	"vehicle_plate" varchar(50),
	"status" varchar(20) DEFAULT 'OFFLINE' NOT NULL,
	"assigned_outlet_id" varchar(30),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_assigned_driver_id_drivers_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_delivery_order_id_delivery_orders_id_fk" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assigned_outlet_id_outlets_id_fk" FOREIGN KEY ("assigned_outlet_id") REFERENCES "public"."outlets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_orders_order_idx" ON "delivery_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_orders_merchant_status_idx" ON "delivery_orders" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "delivery_orders_zone_idx" ON "delivery_orders" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "delivery_orders_driver_idx" ON "delivery_orders" USING btree ("assigned_driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_merchant_outlet_name_idx" ON "delivery_zones" USING btree ("merchant_id","outlet_id","name");--> statement-breakpoint
CREATE INDEX "delivery_zones_merchant_idx" ON "delivery_zones" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "driver_assignments_delivery_idx" ON "driver_assignments" USING btree ("delivery_order_id");--> statement-breakpoint
CREATE INDEX "driver_assignments_driver_idx" ON "driver_assignments" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_locations_driver_idx" ON "driver_locations" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_locations_merchant_idx" ON "driver_locations" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_merchant_user_idx" ON "drivers" USING btree ("merchant_id","user_id");--> statement-breakpoint
CREATE INDEX "drivers_merchant_status_idx" ON "drivers" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "drivers_outlet_idx" ON "drivers" USING btree ("assigned_outlet_id");