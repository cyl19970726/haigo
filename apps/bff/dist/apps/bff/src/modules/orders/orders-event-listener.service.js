var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OrdersEventListener_1;
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service.js';
import { ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME } from '@haigo/shared/config/aptos';
import { MetricsService } from '../metrics/metrics.service.js';
const ORDER_EVENTS_QUERY = /* GraphQL */ `
  query OrderEvents($eventType: String!, $limit: Int!, $cursorVersion: bigint!, $cursorEventIndex: bigint!) {
    events(
      where: {
        type: { _eq: $eventType }
        _or: [
          { transaction_version: { _gt: $cursorVersion } }
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
let OrdersEventListener = OrdersEventListener_1 = class OrdersEventListener {
    constructor(config, orders, metrics) {
        this.config = config;
        this.orders = orders;
        this.metrics = metrics;
        this.logger = new Logger(OrdersEventListener_1.name);
        this.pollHandle = null;
        this.isPolling = false;
        this.lastTxnVersion = BigInt(-1);
        this.lastEventIndex = BigInt(-1);
        this.cooldownUntilMs = 0;
        this.backoffMs = 0;
        this.indexerUrl = this.config.get('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
        this.nodeApiUrl = this.config.get('nodeApiUrl', 'https://fullnode.testnet.aptoslabs.com/v1');
        this.aptosApiKey = this.config.get('aptosApiKey', '');
        this.pageSize = Number(process.env.ORDER_INGESTOR_PAGE_SIZE ?? this.config.get('ingestion.pageSize', 50));
        this.pollingInterval = Number(process.env.ORDER_INGESTOR_INTERVAL_MS ?? this.config.get('ingestion.pollingIntervalMs', 30_000));
        this.maxPagesPerTick = Number(process.env.ORDER_INGESTOR_MAX_PAGES_PER_TICK ?? this.config.get('ingestion.maxPagesPerTick', 1));
        this.startFromLatest = String(process.env.ORDER_INGESTOR_START_FROM_LATEST ?? this.config.get('ingestion.startFromLatest', true))
            .toString()
            .toLowerCase() === 'true';
        this.backfillOffsetVersions = Number(process.env.ORDER_INGESTOR_BACKFILL_OFFSET_VERSIONS ?? this.config.get('ingestion.backfillOffsetVersions', 0));
    }
    async onModuleInit() {
        await this.bootstrapCursor();
        await this.pollOnce();
        this.startPolling();
    }
    async onModuleDestroy() {
        this.stopPolling();
    }
    startPolling() {
        if (this.pollHandle)
            return;
        this.pollHandle = setInterval(() => void this.pollOnce(), this.pollingInterval);
    }
    stopPolling() {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }
    async pollOnce() {
        // respect cooldown
        const now = Date.now();
        if (now < this.cooldownUntilMs) {
            return;
        }
        if (this.isPolling)
            return;
        this.isPolling = true;
        try {
            const eventType = `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::OrderCreated`;
            let hasMore = true;
            let pages = 0;
            while (hasMore && pages < Math.max(1, this.maxPagesPerTick || 1)) {
                const batch = await this.fetchEvents(eventType);
                if (batch.length === 0)
                    break;
                for (const e of batch) {
                    await this.processEvent(e);
                }
                hasMore = batch.length === this.pageSize;
                pages += 1;
                if (hasMore && pages < (this.maxPagesPerTick || 1)) {
                    await new Promise((r) => setTimeout(r, 250));
                }
            }
        }
        catch (e) {
            this.logger.error('OrderEvents poll failed', e instanceof Error ? e.stack : e);
            const next = this.deriveBackoff(e);
            if (next > 0) {
                const jitter = 0.8 + Math.random() * 0.4;
                this.backoffMs = Math.min(Math.max(30_000, (this.backoffMs || 60_000) * 2), 10 * 60_000);
                const pause = Math.max(next, Math.floor(this.backoffMs * jitter));
                this.cooldownUntilMs = Date.now() + pause;
            }
            this.metrics?.incOrderListenerError();
        }
        finally {
            this.isPolling = false;
        }
    }
    async fetchEvents(eventType) {
        const headers = { 'content-type': 'application/json' };
        // Send both headers so either gateway style is satisfied
        if (this.aptosApiKey) {
            headers['x-aptos-api-key'] = this.aptosApiKey;
            headers['authorization'] = `Bearer ${this.aptosApiKey}`;
        }
        const res = await fetch(this.indexerUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: ORDER_EVENTS_QUERY,
                variables: {
                    eventType,
                    limit: this.pageSize,
                    cursorVersion: this.lastTxnVersion.toString(),
                    cursorEventIndex: this.lastEventIndex.toString()
                }
            })
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Indexer returned ${res.status}: ${text}`);
        }
        const json = (await res.json());
        if (json.errors?.length)
            throw new Error(json.errors.map((x) => x.message).join('; '));
        return json.data?.events ?? [];
    }
    deriveBackoff(err) {
        const s = err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err);
        if (/\b(429|rate limit)\b/i.test(s))
            return 60_000;
        if (/\b(408|timeout|timed out)\b/i.test(s))
            return 30_000;
        return 0;
    }
    async fetchLatestLedgerVersion() {
        try {
            const base = (this.nodeApiUrl || '').replace(/\/$/, '');
            const headers = {};
            if (this.aptosApiKey) {
                headers['x-aptos-api-key'] = this.aptosApiKey;
                headers['authorization'] = `Bearer ${this.aptosApiKey}`;
            }
            const resp = await fetch(`${base}/`, { headers });
            if (!resp.ok)
                return 0n;
            const json = (await resp.json());
            return json?.ledger_version ? BigInt(json.ledger_version) : 0n;
        }
        catch {
            return 0n;
        }
    }
    async bootstrapCursor() {
        if (this.startFromLatest) {
            const ledger = await this.fetchLatestLedgerVersion();
            const offset = BigInt(Math.max(0, this.backfillOffsetVersions || 0));
            const startVersion = ledger > 0n ? ledger - (offset > ledger ? ledger : offset) : 0n;
            this.lastTxnVersion = startVersion;
            this.lastEventIndex = BigInt(-1);
            this.logger.log(`Orders: start from latest ledger=${ledger} offset=${offset} -> start=${startVersion}`);
        }
    }
    async processEvent(evt) {
        const meta = await this.resolveTxnMetaByVersion(evt.transaction_version);
        const data = evt.data ?? {};
        const orderId = Number.parseInt(data.order_id ?? data.orderId ?? '0', 10);
        const pricing = data.pricing ?? {};
        await this.orders.applyOrderCreatedEvent({
            txnVersion: BigInt(evt.transaction_version),
            eventIndex: BigInt(evt.event_index),
            txnHash: meta?.hash,
            chainTimestamp: meta?.timestamp,
            orderId,
            seller: String(data.seller ?? data.creator ?? data.seller_address ?? ''),
            warehouse: String(data.warehouse ?? data.warehouse_address ?? ''),
            logisticsInbound: data.logistics_inbound ?? data.inbound_logistics ?? null,
            pricing: {
                amount: Number(pricing.amount ?? 0),
                insuranceFee: Number(pricing.insurance_fee ?? pricing.insuranceFee ?? 0),
                platformFee: Number(pricing.platform_fee ?? pricing.platformFee ?? 0),
                total: Number(pricing.total ?? 0)
            }
        });
        this.lastTxnVersion = BigInt(evt.transaction_version);
        this.lastEventIndex = BigInt(evt.event_index);
        this.metrics?.setOrderListenerLastVersion(this.lastTxnVersion);
    }
    async resolveTxnMetaByVersion(version) {
        try {
            const base = (this.nodeApiUrl || '').replace(/\/$/, '');
            const headers = this.aptosApiKey
                ? { 'x-aptos-api-key': this.aptosApiKey, Authorization: `Bearer ${this.aptosApiKey}` }
                : {};
            const resp = await fetch(`${base}/transactions/by_version/${version}`, { headers });
            if (!resp.ok)
                return null;
            const json = (await resp.json());
            const hash = typeof json?.hash === 'string' ? json.hash : '';
            const micro = typeof json?.timestamp === 'string' ? Number(json.timestamp) : json?.timestamp ?? 0;
            const ts = Number.isFinite(micro) && micro > 0 ? new Date(Math.floor(micro / 1000)) : new Date();
            if (!hash)
                return null;
            return { hash, timestamp: ts };
        }
        catch (e) {
            this.logger.warn(`Fullnode fallback failed: ${String(e)}`);
            return null;
        }
    }
};
OrdersEventListener = OrdersEventListener_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService,
        OrdersService,
        MetricsService])
], OrdersEventListener);
export { OrdersEventListener };
