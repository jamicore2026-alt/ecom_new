-- Inventory activity log attribution.
ALTER TABLE "inventory_logs" ADD COLUMN IF NOT EXISTS "actor_user_id" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "inventory_logs" ADD COLUMN IF NOT EXISTS "actor_name" varchar(255);
