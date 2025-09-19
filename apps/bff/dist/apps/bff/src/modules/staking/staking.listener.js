var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var StakingListener_1;
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service.js';
import { StakingRepository } from './staking.repository.js';
import { APTOS_MODULE_ADDRESS } from '@haigo/shared/config/aptos';
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
let StakingListener = StakingListener_1 = class StakingListener {
    constructor(config, repo, metrics) {
        this.config = config;
        this.repo = repo;
        this.metrics = metrics;
        this.logger = new Logger(StakingListener_1.name);
        this.pollHandle = null;
        this.isPolling = false;
        this.lastTxnVersion = -1n;
        this.lastEventIndex = -1n;
        this.cooldownUntilMs = 0;
        this.backoffMs = 0;
        this.indexerUrl = this.config.get('indexerUrl', 'https://api.testnet.aptoslabs.com/v1/graphql');
        this.nodeApiUrl = this.config.get('nodeApiUrl', 'https://api.testnet.aptoslabs.com/v1');
        this.aptosApiKey = this.config.get('aptosApiKey', '');
        this.pollingInterval = Number(process.env.STAKING_INGESTOR_INTERVAL_MS ?? this.config.get('ingestion.pollingIntervalMs', 30_000));
        this.pageSize = Number(process.env.STAKING_INGESTOR_PAGE_SIZE ?? this.config.get('ingestion.pageSize', 25));
        this.maxPagesPerTick = Number(process.env.STAKING_INGESTOR_MAX_PAGES_PER_TICK ?? this.config.get('ingestion.maxPagesPerTick', 1));
        this.startFromLatest = String(process.env.STAKING_INGESTOR_START_FROM_LATEST ?? this.config.get('ingestion.startFromLatest', true)).toLowerCase() === 'true';
        this.backfillOffsetVersions = Number(process.env.STAKING_INGESTOR_BACKFILL_OFFSET_VERSIONS ?? this.config.get('ingestion.backfillOffsetVersions', 0));
        const envModule = process.env.NEXT_PUBLIC_APTOS_MODULE || this.config.get('NEXT_PUBLIC_APTOS_MODULE');
        const moduleAddr = (envModule && envModule.trim()) || APTOS_MODULE_ADDRESS;
        this.stakeChangedType = `${moduleAddr}::staking::StakeChanged`;
        this.feeUpdatedType = `${moduleAddr}::staking::StorageFeeUpdated`;
    }
    async onModuleInit() {
        const cursor = await this.repo.getLatestCursor();
        if (cursor) {
            this.lastTxnVersion = cursor.version;
            this.lastEventIndex = cursor.index;
            this.logger.log(`Resuming staking cursor at ${this.lastTxnVersion}:${this.lastEventIndex}`);
        }
        else if (this.startFromLatest) {
            // Best-effort start from latest by leaving -1/-1; first fetch will pull only newer events
            this.logger.log('No staking cursor found; starting from latest');
        }
        else {
            this.lastTxnVersion = -1n;
            this.lastEventIndex = -1n;
        }
        this.start();
    }
    onModuleDestroy() {
        if (this.pollHandle)
            clearInterval(this.pollHandle);
    }
    start() {
        if (this.pollHandle)
            return;
        this.logger.log(`Starting StakingListener at interval=${this.pollingInterval}ms pageSize=${this.pageSize}`);
        this.pollHandle = setInterval(() => void this.pollOnce(), this.pollingInterval);
    }
    async pollOnce() {
        if (this.isPolling)
            return;
        const now = Date.now();
        if (now < this.cooldownUntilMs)
            return;
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
                for (const e of events)
                    await this.processEvent(e);
                hasMore = events.length === this.pageSize;
                pages += 1;
            }
            this.metrics?.setStakingListenerLastVersion(this.lastTxnVersion);
        }
        catch (error) {
            this.logger.error('Staking poll failed', error instanceof Error ? error.stack : error);
            this.metrics?.incStakingListenerError();
            this.applyBackoff(error);
        }
        finally {
            this.isPolling = false;
        }
    }
    async fetchEvents() {
        const headers = { 'content-type': 'application/json' };
        if (this.aptosApiKey) {
            headers['x-aptos-api-key'] = this.aptosApiKey;
            headers['authorization'] = `Bearer ${this.aptosApiKey}`;
        }
        const res = await fetch(this.indexerUrl, {
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
            throw new Error(`Indexer responded ${res.status}: ${text}`);
        }
        const payload = (await res.json());
        if (payload.errors?.length)
            throw new Error(payload.errors.map((e) => e.message).join('; '));
        return payload.data?.events ?? [];
    }
    async processEvent(e) {
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
                if (!input.warehouseAddress)
                    return;
                await this.repo.upsertStake(input);
            }
            else if (e.type.endsWith('::StorageFeeUpdated')) {
                const input = {
                    warehouseAddress: String(data.warehouse || data.account || data.address || '').toLowerCase(),
                    feePerUnit: Number(data.fee_per_unit ?? data.feePerUnit ?? 0),
                    txnVersion: BigInt(e.transaction_version),
                    eventIndex: BigInt(e.event_index)
                };
                if (!input.warehouseAddress)
                    return;
                await this.repo.upsertFee(input);
            }
            this.lastTxnVersion = BigInt(e.transaction_version);
            this.lastEventIndex = BigInt(e.event_index);
        }
        catch (err) {
            this.logger.error(`Failed to process staking event v=${e.transaction_version} i=${e.event_index}`, err instanceof Error ? err.stack : err);
            this.metrics?.incStakingListenerError();
        }
    }
    applyBackoff(error) {
        const s = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error);
        const base = /\b(429|rate limit|408|timeout|timed out|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network)\b/i.test(s) ? 30_000 : 0;
        if (!base)
            return;
        const jitter = 0.8 + Math.random() * 0.4;
        this.backoffMs = Math.min(Math.max(30_000, (this.backoffMs || 60_000) * 2), 10 * 60_000);
        const pause = Math.max(base, Math.floor(this.backoffMs * jitter));
        this.cooldownUntilMs = Date.now() + pause;
    }
    // Minimal Fullnode fallback to fetch transaction hash/timestamp by version.
    async resolveTxnMetaByVersion(version) {
        try {
            const base = (this.nodeApiUrl || '').replace(/\/$/, '');
            const headers = {};
            if (this.aptosApiKey) {
                headers['x-aptos-api-key'] = this.aptosApiKey;
                headers['authorization'] = `Bearer ${this.aptosApiKey}`;
            }
            const resp = await fetch(`${base}/transactions/by_version/${version}`, { headers });
            if (!resp.ok) {
                return null;
            }
            const json = (await resp.json());
            const hash = typeof json?.hash === 'string' ? json.hash : '';
            const micro = typeof json?.timestamp === 'string' ? Number(json.timestamp) : json?.timestamp ?? 0;
            const ts = Number.isFinite(micro) && micro > 0 ? new Date(Math.floor(micro / 1000)) : new Date();
            if (!hash)
                return null;
            return { hash, timestamp: ts };
        }
        catch (e) {
            this.logger.warn(`Fullnode fallback failed for version=${version}: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }
};
StakingListener = StakingListener_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService,
        StakingRepository,
        MetricsService])
], StakingListener);
export { StakingListener };
