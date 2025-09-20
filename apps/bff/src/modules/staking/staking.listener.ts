import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service.js';
import { StakingRepository } from './staking.repository.js';
import { APTOS_MODULE_ADDRESS } from '@haigo/shared/config/aptos';

type EventRow = { transaction_version: string; event_index: number; type: string; data: any };

const QUERY = /* GraphQL */ `
  query StakingEvents(
    $eventTypes: [String!]
    $limit: Int!
    $cursorVersion: bigint!
    $cursorEventIndex: bigint!
  ) {
    events(
      where: {
        type: { _in: $eventTypes }
        _or: [
          { transaction_version: { _gt: $cursorVersion } },
          { transaction_version: { _eq: $cursorVersion }, event_index: { _gt: $cursorEventIndex } }
        ]
      }
      order_by: [{ transaction_version: asc }, { event_index: asc }]
      limit: $limit
    ) {
      transaction_version
      event_index
      type
      data
    }
  }
`;

@Injectable()
export class StakingListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StakingListener.name);
  private pollHandle: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastTxnVersion = -1n;
  private lastEventIndex = -1n;
  private cooldownUntilMs = 0;
  private backoffMs = 0;
  private readonly indexerUrls: string[];
  private indexerCursor = 0;
  private readonly nodeApiUrl: string;
  private readonly aptosApiKey: string;
  private readonly pollingInterval: number;
  private readonly pageSize: number;
  private readonly maxPagesPerTick: number;
  private readonly startFromLatest: boolean;
  private readonly backfillOffsetVersions: number;
  private stakeChangedType: string;
  private feeUpdatedType: string;

  constructor(
    private readonly config: ConfigService,
    private readonly repo: StakingRepository,
    private readonly metrics?: MetricsService
  ) {
    const urls = this.config.get<string[]>('indexerUrls');
    const primary = this.config.get<string>('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
    const candidates = Array.isArray(urls) && urls.length > 0 ? urls : [primary];
    this.indexerUrls = Array.from(new Set(candidates.filter((url) => url && url.length > 0)));
    if (this.indexerUrls.length === 0) {
      this.indexerUrls.push('https://indexer.testnet.aptoslabs.com/v1/graphql');
    }
    this.nodeApiUrl = this.config.get<string>('nodeApiUrl', 'https://fullnode.testnet.aptoslabs.com/v1');
    this.aptosApiKey = this.config.get<string>('aptosApiKey', '');
    const defaultInterval = 45_000;
    const defaultPageSize = 10;
    this.pollingInterval = Number(
      process.env.STAKING_INGESTOR_INTERVAL_MS ?? this.config.get<number>('ingestion.pollingIntervalMs', defaultInterval)
    ) || defaultInterval;
    this.pageSize = Number(
      process.env.STAKING_INGESTOR_PAGE_SIZE ?? this.config.get<number>('ingestion.pageSize', defaultPageSize)
    ) || defaultPageSize;
    this.maxPagesPerTick = Number(process.env.STAKING_INGESTOR_MAX_PAGES_PER_TICK ?? this.config.get<number>('ingestion.maxPagesPerTick', 1));
    this.startFromLatest = String(process.env.STAKING_INGESTOR_START_FROM_LATEST ?? this.config.get<boolean>('ingestion.startFromLatest', true)).toLowerCase() === 'true';
    this.backfillOffsetVersions = Number(process.env.STAKING_INGESTOR_BACKFILL_OFFSET_VERSIONS ?? this.config.get<number>('ingestion.backfillOffsetVersions', 0));

    const envModule = process.env.NEXT_PUBLIC_APTOS_MODULE || this.config.get<string>('NEXT_PUBLIC_APTOS_MODULE');
    const moduleAddr = (envModule && envModule.trim()) || APTOS_MODULE_ADDRESS;
    this.stakeChangedType = `${moduleAddr}::staking::StakeChanged`;
    this.feeUpdatedType = `${moduleAddr}::staking::StorageFeeUpdated`;
  }

  async onModuleInit(): Promise<void> {
    const cursor = await this.repo.getLatestCursor();
    if (cursor) {
      this.lastTxnVersion = cursor.version;
      this.lastEventIndex = cursor.index;
      this.logger.log(`Resuming staking cursor at ${this.lastTxnVersion}:${this.lastEventIndex}`);
    } else if (this.startFromLatest) {
      // Best-effort start from latest by leaving -1/-1; first fetch will pull only newer events
      this.logger.log('No staking cursor found; starting from latest');
    } else {
      this.lastTxnVersion = -1n;
      this.lastEventIndex = -1n;
    }
    this.start();
  }

  onModuleDestroy(): any {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  private start() {
    if (this.pollHandle) return;
    this.logger.log(`Starting StakingListener at interval=${this.pollingInterval}ms pageSize=${this.pageSize}`);
    this.pollHandle = setInterval(() => void this.pollOnce(), this.pollingInterval);
  }

  private async pollOnce(): Promise<void> {
    if (this.isPolling) return;
    const now = Date.now();
    if (now < this.cooldownUntilMs) return;
    this.isPolling = true;
    try {
      let pages = 0;
      let hasMore = true;
      while (hasMore && pages < Math.max(1, this.maxPagesPerTick || 1)) {
        const events = await this.fetchEvents();
        if (events.length === 0) {
          hasMore = false;
          break;
        }
        for (const e of events) await this.processEvent(e);
        hasMore = events.length === this.pageSize;
        pages += 1;
      }
      this.metrics?.setStakingListenerLastVersion(this.lastTxnVersion);
    } catch (error) {
      this.logger.error('Staking poll failed', error instanceof Error ? error.stack : error);
      this.metrics?.incStakingListenerError();
      this.applyBackoff(error);
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchEvents(): Promise<EventRow[]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.aptosApiKey) {
      headers['x-aptos-api-key'] = this.aptosApiKey;
      headers['authorization'] = `Bearer ${this.aptosApiKey}`;
    }
    const endpoint = this.indexerUrls[this.indexerCursor] ?? this.indexerUrls[0];
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: QUERY,
        variables: {
          eventTypes: [this.stakeChangedType, this.feeUpdatedType],
          limit: this.pageSize,
          cursorVersion: this.lastTxnVersion.toString(),
          cursorEventIndex: this.lastEventIndex.toString()
        }
      })
    });
    if (!res.ok) {
      const text = await res.text();
      this.handleIndexerError(res.status, text);
      throw new Error(`Indexer responded ${res.status}: ${text}`);
    }
    const payload = (await res.json()) as { data?: { events: EventRow[] }; errors?: Array<{ message: string }> };
    if (payload.errors?.length) {
      const message = payload.errors.map((e) => e.message).join('; ');
      this.handleIndexerError(0, message);
      throw new Error(message);
    }
    return payload.data?.events ?? [];
  }

  private handleIndexerError(status: number, responseText: string) {
    const shouldRotate =
      status === 429 ||
      /monthlycredit cap/i.test(responseText) ||
      /rate limit/i.test(responseText) ||
      /quota/i.test(responseText);
    if (!shouldRotate || this.indexerUrls.length <= 1) {
      return;
    }
    const prev = this.indexerUrls[this.indexerCursor] ?? 'unknown';
    this.indexerCursor = (this.indexerCursor + 1) % this.indexerUrls.length;
    const next = this.indexerUrls[this.indexerCursor];
    this.logger.warn(
      `Staking listener rotating indexer endpoint due to ${status || 'error'} response. ` +
        `Previous=${prev} Next=${next}`
    );
    // Enter cooldown to avoid hammering the new endpoint immediately
    const pause = Math.max(120_000, this.backoffMs || 60_000);
    this.backoffMs = pause;
    this.cooldownUntilMs = Date.now() + pause;
  }

  private async processEvent(e: EventRow): Promise<void> {
    try {
      const data = e.data || {};
      // Best-effort fullnode meta fetch (txn hash/timestamp)
      const meta = await this.resolveTxnMetaByVersion(e.transaction_version).catch(() => null);
      if (e.type.endsWith('::StakeChanged')) {
        const input = {
          warehouseAddress: String(data.warehouse || data.account || data.address || '').toLowerCase(),
          stakedAmount: BigInt(String(data.new_amount ?? data.newAmount ?? 0)),
          txnVersion: BigInt(e.transaction_version),
          eventIndex: BigInt(e.event_index)
        };
        if (!input.warehouseAddress) return;
        await this.repo.upsertStake(input);
      } else if (e.type.endsWith('::StorageFeeUpdated')) {
        const input = {
          warehouseAddress: String(data.warehouse || data.account || data.address || '').toLowerCase(),
          feePerUnit: Number(data.fee_per_unit ?? data.feePerUnit ?? 0),
          txnVersion: BigInt(e.transaction_version),
          eventIndex: BigInt(e.event_index)
        };
        if (!input.warehouseAddress) return;
        await this.repo.upsertFee(input);
      }
      this.lastTxnVersion = BigInt(e.transaction_version);
      this.lastEventIndex = BigInt(e.event_index);
    } catch (err) {
      this.logger.error(`Failed to process staking event v=${e.transaction_version} i=${e.event_index}`, err instanceof Error ? err.stack : err);
      this.metrics?.incStakingListenerError();
    }
  }

  private applyBackoff(error: unknown) {
    const s = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error);
    const base = /\b(429|rate limit|408|timeout|timed out|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network)\b/i.test(s)
      ? 30_000
      : 0;
    if (!base) return;
    const jitter = 0.8 + Math.random() * 0.4;
    this.backoffMs = Math.min(Math.max(30_000, (this.backoffMs || 60_000) * 2), 10 * 60_000);
    const pause = Math.max(base, Math.floor(this.backoffMs * jitter));
    this.cooldownUntilMs = Date.now() + pause;
    this.logger.warn(`Staking listener entering cooldown for ${Math.round(pause / 1000)}s due to: ${s}`);
  }

  // Minimal Fullnode fallback to fetch transaction hash/timestamp by version.
  private async resolveTxnMetaByVersion(version: string): Promise<{ hash: string; timestamp: Date } | null> {
    try {
      const base = (this.nodeApiUrl || '').replace(/\/$/, '');
      const headers: Record<string, string> = {};
      if (this.aptosApiKey) {
        headers['x-aptos-api-key'] = this.aptosApiKey;
        headers['authorization'] = `Bearer ${this.aptosApiKey}`;
      }
      const resp = await fetch(`${base}/transactions/by_version/${version}`, { headers });
      if (!resp.ok) {
        return null;
      }
      const json = (await resp.json()) as { hash?: string; timestamp?: string | number };
      const hash = typeof json?.hash === 'string' ? json.hash : '';
      const micro = typeof json?.timestamp === 'string' ? Number(json.timestamp) : (json?.timestamp as number) ?? 0;
      const ts = Number.isFinite(micro) && micro > 0 ? new Date(Math.floor(micro / 1000)) : new Date();
      if (!hash) return null;
      return { hash, timestamp: ts };
    } catch (e) {
      this.logger.warn(`Fullnode fallback failed for version=${version}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
