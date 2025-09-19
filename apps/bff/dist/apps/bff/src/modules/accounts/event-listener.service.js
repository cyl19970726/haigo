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
const REGISTRATION_EVENTS_QUERY = /* GraphQL */ `
  query RegistrationEvents(
    $eventTypes: [String!]
    $limit: Int!
    $cursorVersion: bigint!
    $cursorEventIndex: Int!
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
      transaction_hash
      account_address
      transaction_timestamp
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
        this.sellerEventType = '0xHAIGO::registry::SellerRegistered';
        this.warehouseEventType = '0xHAIGO::registry::WarehouseRegistered';
        this.indexerUrl = this.configService.get('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
        this.pollingInterval = this.configService.get('ingestion.pollingIntervalMs', 30_000);
        this.pageSize = this.configService.get('ingestion.pageSize', 50);
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
        this.isPolling = true;
        try {
            let hasMore = true;
            while (hasMore) {
                const events = await this.fetchRegistrationEvents();
                if (events.length === 0) {
                    hasMore = false;
                    break;
                }
                for (const event of events) {
                    await this.processEvent(event);
                }
                hasMore = events.length === this.pageSize;
            }
        }
        catch (error) {
            this.logger.error('Failed to poll registration events', error instanceof Error ? error.stack : error);
        }
        finally {
            this.isPolling = false;
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
            this.logger.log('No previous account events found; starting from genesis');
            this.lastTxnVersion = BigInt(-1);
            this.lastEventIndex = BigInt(-1);
        }
    }
    async fetchRegistrationEvents() {
        const response = await fetch(this.indexerUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                query: REGISTRATION_EVENTS_QUERY,
                variables: {
                    eventTypes: [this.sellerEventType, this.warehouseEventType],
                    limit: this.pageSize,
                    cursorVersion: this.lastTxnVersion.toString(),
                    cursorEventIndex: Number(this.lastEventIndex)
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
    async processEvent(event) {
        try {
            const accountInput = this.mapEventToAccount(event);
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
        const timestamp = event.transaction_timestamp ? new Date(event.transaction_timestamp) : new Date();
        return {
            accountAddress,
            role,
            profileHashValue,
            profileUri: data.profile_uri ?? data.profileUri ?? null,
            registeredBy,
            txnVersion: BigInt(event.transaction_version),
            eventIndex: BigInt(event.event_index),
            txnHash: event.transaction_hash,
            chainTimestamp: timestamp
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
