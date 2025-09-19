export default () => ({
  env: process.env.ENV || 'dev',
  port: Number(process.env.PORT) || 3001,
  hasuraUrl: process.env.HASURA_URL || 'http://localhost:8080',
  indexerUrl: process.env.APTOS_INDEXER_URL || 'https://indexer.testnet.aptoslabs.com/v1/graphql',
  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/haigo'
  },
  ingestion: {
    pollingIntervalMs: Number(process.env.ACCOUNT_INGESTOR_INTERVAL_MS) || 30_000,
    pageSize: Number(process.env.ACCOUNT_INGESTOR_PAGE_SIZE) || 50
  },
  media: {
    storageDir: process.env.MEDIA_STORAGE_DIR,
    publicPrefix: process.env.MEDIA_PUBLIC_PREFIX || '/media'
  }
});
