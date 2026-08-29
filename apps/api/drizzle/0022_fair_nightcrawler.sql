ALTER TABLE "orders" ADD COLUMN "warehouse_id" varchar(30);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_warehouse_idx" ON "orders" USING btree ("warehouse_id");