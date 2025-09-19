-- Persisted cursor table for listeners
CREATE TABLE IF NOT EXISTS "event_cursors" (
  "stream_name" TEXT PRIMARY KEY,
  "last_txn_version" BIGINT NOT NULL,
  "last_event_index" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Upsert helper (Postgres 9.5+ supports ON CONFLICT)
-- Example usage in Prisma via upsert on primary key

