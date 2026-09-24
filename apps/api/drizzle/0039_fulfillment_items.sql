-- Split fulfillment lines.
CREATE TABLE IF NOT EXISTS "fulfillment_items" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "fulfillment_id" varchar(30) NOT NULL REFERENCES "fulfillments"("id") ON DELETE CASCADE,
  "order_item_id" varchar(30) NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fulfillment_items_fulfillment_idx" ON "fulfillment_items" ("fulfillment_id");
CREATE INDEX IF NOT EXISTS "fulfillment_items_order_item_idx" ON "fulfillment_items" ("order_item_id");
