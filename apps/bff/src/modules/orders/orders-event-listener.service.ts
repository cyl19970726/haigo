import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service.js';
import { ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME } from '@haigo/shared/config/aptos';
import { MetricsService } from '../metrics/metrics.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

interface OrderCreatedRecord {
  transaction_version: string;
  event_index: number;
  type: string;
  data: any;
}

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

@Injectable()
export class OrdersEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersEventListener.name);
  private pollHandle: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastTxnVersion = BigInt(-1);
  private lastEventIndex = BigInt(-1);
  private readonly indexerUrl: string;
  private readonly nodeApiUrl: string;
  private readonly aptosApiKey: string;
  private readonly pageSize: number;
  private readonly pollingInterval: number;
  private readonly maxPagesPerTick: number;
  private readonly startFromLatest: boolean;
  private readonly backfillOffsetVersions: number;
  private readonly enabled: boolean;
  private cooldownUntilMs = 0;
  private backoffMs = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
    private readonly metrics?: MetricsService,
    private readonly prisma?: PrismaService
  ) {
    this.indexerUrl = this.config.get<string>('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
    this.nodeApiUrl = this.config.get<string>('nodeApiUrl', 'https://fullnode.testnet.aptoslabs.com/v1');
    this.aptosApiKey = this.config.get<string>('aptosApiKey', '');
    this.pageSize = Number(process.env.ORDER_INGESTOR_PAGE_SIZE ?? this.config.get<number>('ingestion.pageSize', 50));
    this.pollingInterval = Number(
      process.env.ORDER_INGESTOR_INTERVAL_MS ?? this.config.get<number>('ingestion.pollingIntervalMs', 30_000)
    );
    this.maxPagesPerTick = Number(process.env.ORDER_INGESTOR_MAX_PAGES_PER_TICK ?? this.config.get<number>('ingestion.maxPagesPerTick', 1));
    this.startFromLatest = String(
      process.env.ORDER_INGESTOR_START_FROM_LATEST ?? this.config.get<boolean>('ingestion.startFromLatest', true)
    )
      .toString()
      .toLowerCase() === 'true';
    this.backfillOffsetVersions = Number(
      process.env.ORDER_INGESTOR_BACKFILL_OFFSET_VERSIONS ?? this.config.get<number>('ingestion.backfillOffsetVersions', 0)
    );
    this.enabled = String(process.env.ENABLE_ORDER_LISTENER ?? this.config.get<boolean>('enableOrderListener', true))
      .toLowerCase() === 'true';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('OrdersEventListener disabled by configuration.');
      return;
    }
    await this.bootstrapCursor();
    await this.pollOnce();
    this.startPolling();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopPolling();
  }

  private startPolling() {
    if (this.pollHandle) return;
    this.pollHandle = setInterval(() => void this.pollOnce(), this.pollingInterval);
  }
  private stopPolling() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async pollOnce(): Promise<void> {
    // respect cooldown
    const now = Date.now();
    if (now < this.cooldownUntilMs) {
      return;
    }
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      const eventType = `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::OrderCreated`;
      let hasMore = true;
      let pages = 0;
      while (hasMore && pages < Math.max(1, this.maxPagesPerTick || 1)) {
        const batch = await this.fetchEvents(eventType);
        if (batch.length === 0) break;
        let lastV = this.lastTxnVersion;
        let lastI = this.lastEventIndex;
        for (const e of batch) {
          await this.processEvent(e);
          lastV = BigInt(e.transaction_version);
          lastI = BigInt(e.event_index);
        }
        hasMore = batch.length === this.pageSize;
        pages += 1;
        // Persist cursor after each page
        await this.saveCursor('orders_created', lastV, lastI);
        if (hasMore && pages < (this.maxPagesPerTick || 1)) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    } catch (e) {
      this.logger.error('OrderEvents poll failed', e instanceof Error ? e.stack : e);
      const next = this.deriveBackoff(e);
      if (next > 0) {
        const jitter = 0.8 + Math.random() * 0.4;
        this.backoffMs = Math.min(Math.max(30_000, (this.backoffMs || 60_000) * 2), 10 * 60_000);
        const pause = Math.max(next, Math.floor(this.backoffMs * jitter));
        this.cooldownUntilMs = Date.now() + pause;
      }
      this.metrics?.incOrderListenerError();
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchEvents(eventType: string): Promise<OrderCreatedRecord[]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
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
    const json = (await res.json()) as { data?: { events: OrderCreatedRecord[] }; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(json.errors.map((x) => x.message).join('; '));
    return json.data?.events ?? [];
  }

  private deriveBackoff(err: unknown): number {
    const s = err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err);
    if (/\b(429|rate limit)\b/i.test(s)) return 60_000;
    if (/\b(408|timeout|timed out)\b/i.test(s)) return 30_000;
    if (/(fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network)/i.test(s)) return 30_000;
    return 0;
  }

  private async fetchLatestLedgerVersion(): Promise<bigint> {
    try {
      const base = (this.nodeApiUrl || '').replace(/\/$/, '');
      const headers: Record<string, string> = {};
      if (this.aptosApiKey) {
        headers['x-aptos-api-key'] = this.aptosApiKey;
        headers['authorization'] = `Bearer ${this.aptosApiKey}`;
      }
      const resp = await fetch(`${base}/`, { headers });
      if (!resp.ok) return 0n;
      const json = (await resp.json()) as { ledger_version?: string };
      return json?.ledger_version ? BigInt(json.ledger_version) : 0n;
    } catch {
      return 0n;
    }
  }

  private async bootstrapCursor(): Promise<void> {
    // Try load from DB first
    try {
      const cursor = await this.prisma?.eventCursor.findUnique({ where: { streamName: 'orders_created' } });
      if (cursor) {
        this.lastTxnVersion = cursor.lastTxnVersion as unknown as bigint;
        this.lastEventIndex = cursor.lastEventIndex as unknown as bigint;
        this.logger.log(`Orders: loaded persisted cursor v=${this.lastTxnVersion} i=${this.lastEventIndex}`);
        return;
      }
    } catch (e) {
      this.logger.warn(`Orders: failed loading cursor: ${String(e)}`);
    }

    if (this.startFromLatest) {
      const ledger = await this.fetchLatestLedgerVersion();
      const offset = BigInt(Math.max(0, this.backfillOffsetVersions || 0));
      const startVersion = ledger > 0n ? ledger - (offset > ledger ? ledger : offset) : 0n;
      this.lastTxnVersion = startVersion;
      this.lastEventIndex = BigInt(-1);
      this.logger.log(
        `Orders: start from latest ledger=${ledger} offset=${offset} -> start=${startVersion}`
      );
    }
  }
  private async processEvent(evt: OrderCreatedRecord): Promise<void> {
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

  private async resolveTxnMetaByVersion(version: string): Promise<{ hash: string; timestamp: Date } | null> {
    try {
      const base = (this.nodeApiUrl || '').replace(/\/$/, '');
      const headers: Record<string, string> = this.aptosApiKey
        ? { 'x-aptos-api-key': this.aptosApiKey, Authorization: `Bearer ${this.aptosApiKey}` }
        : {};
      const resp = await fetch(`${base}/transactions/by_version/${version}`, { headers });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { hash?: string; timestamp?: string | number };
      const hash = typeof json?.hash === 'string' ? json.hash : '';
      const micro = typeof json?.timestamp === 'string' ? Number(json.timestamp) : (json?.timestamp as number) ?? 0;
      const ts = Number.isFinite(micro) && micro > 0 ? new Date(Math.floor(micro / 1000)) : new Date();
      if (!hash) return null;
      return { hash, timestamp: ts };
    } catch (e) {
      this.logger.warn(`Fullnode fallback failed: ${String(e)}`);
      return null;
    }
  }

  private async saveCursor(stream: string, v: bigint, i: bigint): Promise<void> {
    try {
      await this.prisma?.eventCursor.upsert({
        where: { streamName: stream },
        create: { streamName: stream, lastTxnVersion: v as unknown as bigint, lastEventIndex: i as unknown as bigint },
        update: { lastTxnVersion: v as unknown as bigint, lastEventIndex: i as unknown as bigint }
      });
    } catch (e) {
      this.logger.warn(`Orders: failed saving cursor: ${String(e)}`);
    }
  }
}
