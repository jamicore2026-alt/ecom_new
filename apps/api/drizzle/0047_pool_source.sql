-- Optional transfer source: NULL = unallocated global pool.
ALTER TABLE "stock_transfers" ALTER COLUMN "from_warehouse_id" DROP NOT NULL;
