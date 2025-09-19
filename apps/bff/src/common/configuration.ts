export default () => ({
  env: process.env.ENV || 'dev',
  port: Number(process.env.PORT) || 3001,
  hasuraUrl: process.env.HASURA_URL || 'http://localhost:8080',
  hasuraAdminSecret: process.env.HASURA_ADMIN_SECRET || '',
  // Prefer Aptos Labs gateway which supports both REST and GraphQL with API key
  indexerUrl: process.env.APTOS_INDEXER_URL || 'https://api.testnet.aptoslabs.com/v1/graphql',
  // Base URL for Aptos Fullnode REST. Used as a fallback when the Indexer
  // does not expose certain fields (e.g., transaction hash/timestamp) in POC.
  nodeApiUrl: process.env.APTOS_NODE_API_URL || 'https://api.testnet.aptoslabs.com/v1',
  // Optional API key for Aptos Build fullnode endpoints (e.g. api.buildwithaptos.com).
  // When set, BFF will send header `x-aptos-api-key` in fullnode fallback calls.
  aptosApiKey: process.env.APTOS_NODE_API_KEY || '',
  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/haigo'
  },
  ingestion: {
    // Listener polling interval: default 30s
    pollingIntervalMs: Number(process.env.ACCOUNT_INGESTOR_INTERVAL_MS) || 30_000,
    // Batch size (per GraphQL request). Smaller size reduces upstream CU usage.
    pageSize: Number(process.env.ACCOUNT_INGESTOR_PAGE_SIZE) || 25,
    // Limit how many pages to fetch per tick to avoid burst CU consumption.
    maxPagesPerTick: Number(process.env.ACCOUNT_INGESTOR_MAX_PAGES_PER_TICK) || 1,
    // If true and no existing cursor, start from latest ledger version (skip backfill from genesis)
    startFromLatest: String(process.env.ACCOUNT_INGESTOR_START_FROM_LATEST || 'true').toLowerCase() === 'true',
    // If starting from latest, optionally subtract this many versions to cover a small window
    backfillOffsetVersions: Number(process.env.ACCOUNT_INGESTOR_BACKFILL_OFFSET_VERSIONS) || 0
  },
  media: {
    storageDir: process.env.MEDIA_STORAGE_DIR,
    publicPrefix: process.env.MEDIA_PUBLIC_PREFIX || '/media'
  },
  directory: {
    cacheTtlMs: Number(process.env.DIRECTORY_CACHE_TTL_MS) || 30_000
  },
  enableOrderListener: String(process.env.ENABLE_ORDER_LISTENER ?? 'true').toLowerCase() === 'true'
});
