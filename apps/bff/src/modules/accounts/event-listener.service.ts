import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountsRepository, AccountUpsertInput } from './accounts.repository.js';
import { APTOS_MODULE_ADDRESS } from '@haigo/shared/config/aptos';

interface RegistrationEventRecord {
  transaction_version: string;
  event_index: number;
  type: string;
  data: Record<string, any>;
  account_address: string;
}

const REGISTRATION_EVENTS_QUERY = /* GraphQL */ `
  query RegistrationEvents(
    $eventTypes: [String!]
    $limit: Int!
    $cursorVersion: bigint!
    $cursorEventIndex: bigint!
  ) {
    events(
      where: {
        type: { _in: $eventTypes }
        _or: [
          { transaction_version: { _gt: $cursorVersion } }
          {
            transaction_version: { _eq: $cursorVersion }
            event_index: { _gt: $cursorEventIndex }
          }
        ]
      }
      order_by: [{ transaction_version: asc }, { event_index: asc }]
      limit: $limit
    ) {
      transaction_version
      event_index
      type
      data
      account_address
    }
  }
`;

@Injectable()
export class AccountsEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountsEventListener.name);
  private pollHandle: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastTxnVersion = BigInt(-1);
  private lastEventIndex = BigInt(-1);
  // Simple in-process rate limiter: when upstream signals 408/429, pause polling
  // for a backoff window with jitter. Resets on success.
  private cooldownUntilMs = 0;
  private backoffMs = 0;
  private sellerEventType: string;
  private warehouseEventType: string;
  private readonly indexerUrls: string[];
  private indexerCursor = 0;
  private readonly nodeApiUrl: string;
  private readonly pollingInterval: number;
  private readonly pageSize: number;
  private readonly aptosApiKey: string;
  private readonly maxPagesPerTick: number;
  private readonly startFromLatest: boolean;
  private readonly backfillOffsetVersions: number;

  constructor(private readonly configService: ConfigService, private readonly accountsRepository: AccountsRepository) {
    const urls = this.configService.get<string[]>('indexerUrls');
    const primary = this.configService.get<string>('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
    const candidates = Array.isArray(urls) && urls.length > 0 ? urls : [primary];
    this.indexerUrls = Array.from(new Set(candidates.filter((url) => url && url.length > 0)));
    if (this.indexerUrls.length === 0) {
      this.indexerUrls.push('https://indexer.testnet.aptoslabs.com/v1/graphql');
    }
    this.nodeApiUrl = this.configService.get<string>('nodeApiUrl', 'https://fullnode.testnet.aptoslabs.com/v1');
    this.pollingInterval = this.configService.get<number>('ingestion.pollingIntervalMs', 30_000);
    this.pageSize = this.configService.get<number>('ingestion.pageSize', 50);
    this.aptosApiKey = this.configService.get<string>('aptosApiKey', '');
    this.maxPagesPerTick = this.configService.get<number>('ingestion.maxPagesPerTick', 1);
    this.startFromLatest = this.configService.get<boolean>('ingestion.startFromLatest', true);
    this.backfillOffsetVersions = this.configService.get<number>('ingestion.backfillOffsetVersions', 0);
    // Resolve registry module address at runtime to ensure env has been loaded
    const envModule = process.env.NEXT_PUBLIC_APTOS_MODULE || this.configService.get<string>('NEXT_PUBLIC_APTOS_MODULE');
    const registryModuleAddress = (envModule && envModule.trim()) || APTOS_MODULE_ADDRESS;
    this.sellerEventType = `${registryModuleAddress}::registry::SellerRegistered`;
    this.warehouseEventType = `${registryModuleAddress}::registry::WarehouseRegistered`;
  }

  async onModuleInit(): Promise<void> {
    await this.bootstrapCursor();
    await this.pollOnce();
    this.startPolling();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopPolling();
  }

  private startPolling(): void {
    if (this.pollHandle) {
      return;
    }

    this.logger.log(`Starting account registration poller at ${this.pollingInterval}ms interval`);
    this.pollHandle = setInterval(() => {
      void this.pollOnce();
    }, this.pollingInterval);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.isPolling) {
      this.logger.warn('Skip poll tick because previous cycle is still running');
      return;
    }

    // Respect cooldown when upstream has rate-limited or timed-out recently.
    const now = Date.now();
    if (now < this.cooldownUntilMs) {
      const remaining = Math.max(0, this.cooldownUntilMs - now);
      this.logger.debug?.(`Skip poll due to cooldown ${remaining}ms remaining`);
      return;
    }

    this.isPolling = true;

    try {
      let pages = 0;
      let hasMore = true;
      while (hasMore && pages <  Math.max(1, this.maxPagesPerTick || 1)) {
        const events = await this.fetchRegistrationEvents();

        if (events.length === 0) {
          hasMore = false;
          break;
        }

        for (const event of events) {
          await this.processEvent(event);
        }

        hasMore = events.length === this.pageSize;
        pages += 1;
        if (hasMore && pages < (this.maxPagesPerTick || 1)) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    } catch (error) {
      this.logger.error('Failed to poll registration events', error instanceof Error ? error.stack : error);
      // Apply exponential backoff with jitter for 408/429 like upstream signals
      const next = this.deriveBackoff(error);
      if (next > 0) {
        // jitter 80%-120%
        const jitter = 0.8 + Math.random() * 0.4;
        this.backoffMs = Math.min(Math.max(30_000, (this.backoffMs || 60_000) * 2), 10 * 60_000);
        const pause = Math.max(next, Math.floor(this.backoffMs * jitter));
        this.cooldownUntilMs = Date.now() + pause;
        this.logger.warn(`Apply cooldown=${pause}ms (backoff=${this.backoffMs}ms)`);
      }
    } finally {
      this.isPolling = false;
    }
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
      // Aptos REST returns microseconds since epoch as string; convert to ms.
      const micro = typeof json?.timestamp === 'string' ? Number(json.timestamp) : (json?.timestamp as number) ?? 0;
      const ts = Number.isFinite(micro) && micro > 0 ? new Date(Math.floor(micro / 1000)) : new Date();
      if (!hash) return null;
      return { hash, timestamp: ts };
    } catch (e) {
      this.logger.warn(`Fullnode fallback failed for version=${version}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
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
    const latest = await this.accountsRepository.getLatestProcessedEvent();
    if (latest) {
      this.lastTxnVersion = latest.txnVersion;
      this.lastEventIndex = latest.eventIndex;
      this.logger.log(`Resuming polling from cursor ${this.lastTxnVersion}:${this.lastEventIndex}`);
    } else {
      if (this.startFromLatest) {
        const ledger = await this.fetchLatestLedgerVersion();
        const offset = BigInt(Math.max(0, this.backfillOffsetVersions || 0));
        const startVersion = ledger > 0n ? ledger - (offset > ledger ? ledger : offset) : 0n;
        this.lastTxnVersion = startVersion;
        this.lastEventIndex = BigInt(-1);
        this.logger.log(`No previous account events; starting from latest ledger=${ledger} offset=${offset} -> start=${startVersion}`);
      } else {
        this.logger.log('No previous account events found; starting from genesis');
        this.lastTxnVersion = BigInt(-1);
        this.lastEventIndex = BigInt(-1);
      }
    }
  }

  private async fetchRegistrationEvents(): Promise<RegistrationEventRecord[]> {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (this.aptosApiKey) {
      headers['x-aptos-api-key'] = this.aptosApiKey;
      headers['authorization'] = `Bearer ${this.aptosApiKey}`;
    }
    const endpoint = this.indexerUrls[this.indexerCursor] ?? this.indexerUrls[0];
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: REGISTRATION_EVENTS_QUERY,
        variables: {
          eventTypes: [this.sellerEventType, this.warehouseEventType],
          limit: this.pageSize,
          cursorVersion: this.lastTxnVersion.toString(),
          cursorEventIndex: this.lastEventIndex.toString()
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      this.handleIndexerError(response.status, text);
      throw new Error(`Indexer GraphQL responded with ${response.status}: ${text}`);
    }

    const payload = (await response.json()) as {
      data?: { events: RegistrationEventRecord[] };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors && payload.errors.length > 0) {
      const message = payload.errors.map((error) => error.message).join('; ');
      this.handleIndexerError(0, message);
      throw new Error(`Indexer GraphQL errors: ${message}`);
    }

    if (!payload.data) {
      return [];
    }

    return payload.data.events ?? [];
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
      `Accounts listener rotating indexer endpoint due to ${status || 'error'} response. Previous=${prev} Next=${next}`
    );
    const pause = Math.max(120_000, this.backoffMs || 60_000);
    this.backoffMs = pause;
    this.cooldownUntilMs = Date.now() + pause;
  }

  // Inspect error messages to derive backoff trigger for 408/429
  private deriveBackoff(error: unknown): number {
    const s = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error);
    if (/\b(429|rate limit)\b/i.test(s)) return 60_000; // 1 min min-backoff
    if (/\b(408|timeout|timed out)\b/i.test(s)) return 30_000; // 30s
    // Network-layer transient failures from undici/node: fetch failed, ECONNRESET, ENOTFOUND, EAI_AGAIN, socket hang up
    if (/(fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network)/i.test(s)) return 30_000;
    return 0;
  }

  private async processEvent(event: RegistrationEventRecord): Promise<void> {
    try {
      const accountInput = this.mapEventToAccount(event);

      // Fullnode fallback when Indexer schema does not return txn hash/timestamp.
      if (!accountInput.txnHash || !accountInput.chainTimestamp) {
        const meta = await this.resolveTxnMetaByVersion(event.transaction_version);
        if (meta) {
          accountInput.txnHash = meta.hash;
          accountInput.chainTimestamp = meta.timestamp;
        } else {
          // POC downgrade: keep processing with synthetic values.
          if (!accountInput.txnHash) {
            accountInput.txnHash = `unknown:${event.transaction_version}`;
          }
          if (!accountInput.chainTimestamp) {
            accountInput.chainTimestamp = new Date();
          }
          this.logger.warn(
            `Used fallback txn meta for ${event.transaction_version}:${event.event_index}`
          );
        }
      }

      await this.accountsRepository.upsertFromEvent(accountInput);
      this.lastTxnVersion = accountInput.txnVersion;
      this.lastEventIndex = accountInput.eventIndex;
    } catch (error) {
      this.logger.error(
        `Failed to process event ${event.transaction_version}:${event.event_index}`,
        error instanceof Error ? error.stack : error
      );
    }
  }

  private mapEventToAccount(event: RegistrationEventRecord): AccountUpsertInput {
    const data = event.data ?? {};
    const role = this.extractRole(event.type);
    const profileHashValue = this.extractHashValue(data);

    if (!profileHashValue) {
      throw new Error('Missing profile hash value in event payload');
    }

    const accountAddress = this.normalizeAddress(data.account ?? data.address ?? event.account_address);
    if (!accountAddress) {
      throw new Error('Missing account address in event payload');
    }

    const registeredBy = this.normalizeAddress(event.account_address ?? accountAddress);

    return {
      accountAddress,
      role,
      profileHashValue,
      profileUri: data.profile_uri ?? data.profileUri ?? null,
      registeredBy,
      txnVersion: BigInt(event.transaction_version),
      eventIndex: BigInt(event.event_index),
      txnHash: '',
      chainTimestamp: undefined as unknown as Date // will be filled by Fullnode fallback
    };
  }

  private extractRole(eventType: string): 'seller' | 'warehouse' {
    if (eventType.includes('SellerRegistered')) {
      return 'seller';
    }

    if (eventType.includes('WarehouseRegistered')) {
      return 'warehouse';
    }

    this.logger.warn(`Unknown registration event type ${eventType}, defaulting to seller role`);
    return 'seller';
  }

  private extractHashValue(data: Record<string, any>): string | null {
    // Support common shapes and naming styles from Indexer payloads
    // 1) Direct string fields
    const directStr =
      data.profile_hash ??
      data.profileHash ??
      data.hash ??
      data.hash_value ??
      data.hashValue ??
      data.profile_hash_value;
    if (typeof directStr === 'string') {
      return this.ensureLowercaseHash(directStr);
    }

    // 2) Nested object container with various keys
    const container = data.profile_hash ?? data.profileHash ?? data.hash;
    if (container && typeof container === 'object') {
      const value = container.value ?? container.hash ?? container.hash_value ?? null;
      return typeof value === 'string' ? this.ensureLowercaseHash(value) : null;
    }

    return null;
  }

  private ensureLowercaseHash(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      throw new Error(`Invalid hash format: ${value}`);
    }
    return normalized;
  }

  private normalizeAddress(address: string | undefined): string {
    if (!address) {
      return '';
    }
    return address.toLowerCase();
  }
}
