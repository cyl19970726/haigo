-- O1 Orders: introduce OrderStatus enum, orders and order_events tables

-- 1) Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM (
      'ORDER_DRAFT',
      'ONCHAIN_CREATED',
      'WAREHOUSE_IN',
      'IN_STORAGE',
      'WAREHOUSE_OUT'
    );
  END IF;
END $$;

-- 2) orders table
CREATE TABLE IF NOT EXISTS "orders" (
  "id" BIGSERIAL PRIMARY KEY,
  "record_uid" TEXT NOT NULL UNIQUE,
  "creator_address" TEXT NOT NULL,
  "warehouse_address" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL,
  "order_id" INTEGER NULL,
  "payload_json" JSONB NULL,
  "txn_version" BIGINT NULL,
  "event_index" BIGINT NULL,
  "txn_hash" TEXT NULL,
  "chain_timestamp" TIMESTAMP(3) NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for orders
CREATE INDEX IF NOT EXISTS "orders_creator_idx" ON "orders" ("creator_address");
CREATE INDEX IF NOT EXISTS "orders_warehouse_idx" ON "orders" ("warehouse_address");

-- 3) order_events table
CREATE TABLE IF NOT EXISTS "order_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "record_uid" TEXT NOT NULL,
  "order_id" INTEGER NULL,
  "type" TEXT NOT NULL,
  "txn_version" BIGINT NOT NULL,
  "event_index" BIGINT NOT NULL,
  "txn_hash" TEXT NULL,
  "chain_timestamp" TIMESTAMP(3) NULL,
  "data" JSONB NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Uniq cursor on (txn_version, event_index)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'order_events_cursor_uniq'
  ) THEN
    CREATE UNIQUE INDEX "order_events_cursor_uniq" ON "order_events" ("txn_version", "event_index");
  END IF;
END $$;

-- Index on record_uid
CREATE INDEX IF NOT EXISTS "order_events_record_uid_idx" ON "order_events" ("record_uid");

-- Trigger to update updated_at on orders (optional simple approach)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_set_updated_at ON "orders";
CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON "orders"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

