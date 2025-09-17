import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountsRepository, AccountUpsertInput } from './accounts.repository';

interface RegistrationEventRecord {
  transaction_version: string;
  event_index: number;
  type: string;
  data: Record<string, any>;
  transaction_hash: string;
  account_address: string;
  transaction_timestamp: string;
}

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

@Injectable()
export class AccountsEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountsEventListener.name);
  private pollHandle: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastTxnVersion = BigInt(-1);
  private lastEventIndex = BigInt(-1);
  private readonly sellerEventType = '0xHAIGO::registry::SellerRegistered';
  private readonly warehouseEventType = '0xHAIGO::registry::WarehouseRegistered';
  private readonly indexerUrl: string;
  private readonly pollingInterval: number;
  private readonly pageSize: number;

  constructor(private readonly configService: ConfigService, private readonly accountsRepository: AccountsRepository) {
    this.indexerUrl = this.configService.get<string>('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
    this.pollingInterval = this.configService.get<number>('ingestion.pollingIntervalMs', 30_000);
    this.pageSize = this.configService.get<number>('ingestion.pageSize', 50);
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
    } catch (error) {
      this.logger.error('Failed to poll registration events', error instanceof Error ? error.stack : error);
    } finally {
      this.isPolling = false;
    }
  }

  private async bootstrapCursor(): Promise<void> {
    const latest = await this.accountsRepository.getLatestProcessedEvent();
    if (latest) {
      this.lastTxnVersion = latest.txnVersion;
      this.lastEventIndex = latest.eventIndex;
      this.logger.log(`Resuming polling from cursor ${this.lastTxnVersion}:${this.lastEventIndex}`);
    } else {
      this.logger.log('No previous account events found; starting from genesis');
      this.lastTxnVersion = BigInt(-1);
      this.lastEventIndex = BigInt(-1);
    }
  }

  private async fetchRegistrationEvents(): Promise<RegistrationEventRecord[]> {
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

    const payload = (await response.json()) as {
      data?: { events: RegistrationEventRecord[] };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors && payload.errors.length > 0) {
      throw new Error(`Indexer GraphQL errors: ${payload.errors.map((error) => error.message).join('; ')}`);
    }

    if (!payload.data) {
      return [];
    }

    return payload.data.events ?? [];
  }

  private async processEvent(event: RegistrationEventRecord): Promise<void> {
    try {
      const accountInput = this.mapEventToAccount(event);
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
