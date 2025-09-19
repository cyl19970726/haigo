var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AccountsEventListener_1;
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountsRepository } from './accounts.repository.js';
import { APTOS_MODULE_ADDRESS } from '@haigo/shared/config/aptos';
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
let AccountsEventListener = AccountsEventListener_1 = class AccountsEventListener {
    constructor(configService, accountsRepository) {
        this.configService = configService;
        this.accountsRepository = accountsRepository;
        this.logger = new Logger(AccountsEventListener_1.name);
        this.pollHandle = null;
        this.isPolling = false;
        this.lastTxnVersion = BigInt(-1);
        this.lastEventIndex = BigInt(-1);
        // Simple in-process rate limiter: when upstream signals 408/429, pause polling
        // for a backoff window with jitter. Resets on success.
        this.cooldownUntilMs = 0;
        this.backoffMs = 0;
        this.indexerUrl = this.configService.get('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
        this.nodeApiUrl = this.configService.get('nodeApiUrl', 'https://fullnode.testnet.aptoslabs.com/v1');
        this.pollingInterval = this.configService.get('ingestion.pollingIntervalMs', 30_000);
        this.pageSize = this.configService.get('ingestion.pageSize', 50);
        this.aptosApiKey = this.configService.get('aptosApiKey', '');
        this.maxPagesPerTick = this.configService.get('ingestion.maxPagesPerTick', 1);
        this.startFromLatest = this.configService.get('ingestion.startFromLatest', true);
        this.backfillOffsetVersions = this.configService.get('ingestion.backfillOffsetVersions', 0);
        // Resolve registry module address at runtime to ensure env has been loaded
        const envModule = process.env.NEXT_PUBLIC_APTOS_MODULE || this.configService.get('NEXT_PUBLIC_APTOS_MODULE');
        const registryModuleAddress = (envModule && envModule.trim()) || APTOS_MODULE_ADDRESS;
        this.sellerEventType = `${registryModuleAddress}::registry::SellerRegistered`;
        this.warehouseEventType = `${registryModuleAddress}::registry::WarehouseRegistered`;
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
        if (this.pollHandle) {
            return;
        }
        this.logger.log(`Starting account registration poller at ${this.pollingInterval}ms interval`);
        this.pollHandle = setInterval(() => {
            void this.pollOnce();
        }, this.pollingInterval);
    }
    stopPolling() {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }
    async pollOnce() {
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
            while (hasMore && pages < Math.max(1, this.maxPagesPerTick || 1)) {
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
        }
        catch (error) {
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
        }
        finally {
            this.isPolling = false;
        }
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
            // Aptos REST returns microseconds since epoch as string; convert to ms.
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
        const latest = await this.accountsRepository.getLatestProcessedEvent();
        if (latest) {
            this.lastTxnVersion = latest.txnVersion;
            this.lastEventIndex = latest.eventIndex;
            this.logger.log(`Resuming polling from cursor ${this.lastTxnVersion}:${this.lastEventIndex}`);
        }
        else {
            if (this.startFromLatest) {
                const ledger = await this.fetchLatestLedgerVersion();
                const offset = BigInt(Math.max(0, this.backfillOffsetVersions || 0));
                const startVersion = ledger > 0n ? ledger - (offset > ledger ? ledger : offset) : 0n;
                this.lastTxnVersion = startVersion;
                this.lastEventIndex = BigInt(-1);
                this.logger.log(`No previous account events; starting from latest ledger=${ledger} offset=${offset} -> start=${startVersion}`);
            }
            else {
                this.logger.log('No previous account events found; starting from genesis');
                this.lastTxnVersion = BigInt(-1);
                this.lastEventIndex = BigInt(-1);
            }
        }
    }
    async fetchRegistrationEvents() {
        const headers = {
            'content-type': 'application/json'
        };
        if (this.aptosApiKey) {
            headers['x-aptos-api-key'] = this.aptosApiKey;
            headers['authorization'] = `Bearer ${this.aptosApiKey}`;
        }
        const response = await fetch(this.indexerUrl, {
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
            throw new Error(`Indexer GraphQL responded with ${response.status}: ${text}`);
        }
        const payload = (await response.json());
        if (payload.errors && payload.errors.length > 0) {
            throw new Error(`Indexer GraphQL errors: ${payload.errors.map((error) => error.message).join('; ')}`);
        }
        if (!payload.data) {
            return [];
        }
        return payload.data.events ?? [];
    }
    // Inspect error messages to derive backoff trigger for 408/429
    deriveBackoff(error) {
        const s = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : String(error);
        if (/\b(429|rate limit)\b/i.test(s))
            return 60_000; // 1 min min-backoff
        if (/\b(408|timeout|timed out)\b/i.test(s))
            return 30_000; // 30s
        return 0;
    }
    async processEvent(event) {
        try {
            const accountInput = this.mapEventToAccount(event);
            // Fullnode fallback when Indexer schema does not return txn hash/timestamp.
            if (!accountInput.txnHash || !accountInput.chainTimestamp) {
                const meta = await this.resolveTxnMetaByVersion(event.transaction_version);
                if (meta) {
                    accountInput.txnHash = meta.hash;
                    accountInput.chainTimestamp = meta.timestamp;
                }
                else {
                    // POC downgrade: keep processing with synthetic values.
                    if (!accountInput.txnHash) {
                        accountInput.txnHash = `unknown:${event.transaction_version}`;
                    }
                    if (!accountInput.chainTimestamp) {
                        accountInput.chainTimestamp = new Date();
                    }
                    this.logger.warn(`Used fallback txn meta for ${event.transaction_version}:${event.event_index}`);
                }
            }
            await this.accountsRepository.upsertFromEvent(accountInput);
            this.lastTxnVersion = accountInput.txnVersion;
            this.lastEventIndex = accountInput.eventIndex;
        }
        catch (error) {
            this.logger.error(`Failed to process event ${event.transaction_version}:${event.event_index}`, error instanceof Error ? error.stack : error);
        }
    }
    mapEventToAccount(event) {
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
            chainTimestamp: undefined // will be filled by Fullnode fallback
        };
    }
    extractRole(eventType) {
        if (eventType.includes('SellerRegistered')) {
            return 'seller';
        }
        if (eventType.includes('WarehouseRegistered')) {
            return 'warehouse';
        }
        this.logger.warn(`Unknown registration event type ${eventType}, defaulting to seller role`);
        return 'seller';
    }
    extractHashValue(data) {
        const hashContainer = data.profile_hash ?? data.profileHash ?? data.hash;
        if (!hashContainer) {
            return typeof data.profile_hash_value === 'string' ? data.profile_hash_value : null;
        }
        if (typeof hashContainer === 'string') {
            return this.ensureLowercaseHash(hashContainer);
        }
        if (typeof hashContainer === 'object') {
            const value = hashContainer.value ?? hashContainer.hash ?? hashContainer.hash_value ?? null;
            return value ? this.ensureLowercaseHash(value) : null;
        }
        return null;
    }
    ensureLowercaseHash(value) {
        const normalized = value.trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(normalized)) {
            throw new Error(`Invalid hash format: ${value}`);
        }
        return normalized;
    }
    normalizeAddress(address) {
        if (!address) {
            return '';
        }
        return address.toLowerCase();
    }
};
AccountsEventListener = AccountsEventListener_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService, AccountsRepository])
], AccountsEventListener);
export { AccountsEventListener };
