export default () => ({
  env: process.env.ENV || 'dev',
  port: Number(process.env.PORT) || 3001,
  hasuraUrl: process.env.HASURA_URL || 'http://localhost:8080',
  indexerUrl: process.env.APTOS_INDEXER_URL || 'https://indexer.testnet.aptoslabs.com/v1/graphql'
});
