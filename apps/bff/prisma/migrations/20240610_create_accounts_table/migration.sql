-- Create account role enum
CREATE TYPE "AccountRole" AS ENUM ('seller', 'warehouse');

-- Create accounts table
CREATE TABLE "accounts" (
  "account_address" TEXT PRIMARY KEY,
  "role" "AccountRole" NOT NULL,
  "profile_hash_algo" TEXT NOT NULL DEFAULT 'blake3',
  "profile_hash_value" TEXT NOT NULL,
  "profile_uri" TEXT,
  "registered_by" TEXT NOT NULL,
  "txn_version" BIGINT NOT NULL,
  "event_index" BIGINT NOT NULL,
  "txn_hash" TEXT NOT NULL,
  "chain_timestamp" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplication index on transaction coordinates
CREATE UNIQUE INDEX "accounts_event_uniq" ON "accounts" ("txn_version", "event_index");

-- Address lookup index for fast queries
CREATE INDEX "accounts_address_idx" ON "accounts" ("account_address");

-- Trigger to update updated_at on row modification
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_accounts_updated_at
BEFORE UPDATE ON "accounts"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
