import { ConfigService } from '@nestjs/config';
import { AccountsRepository } from '../src/modules/accounts/accounts.repository';
import { AccountsEventListener } from '../src/modules/accounts/event-listener.service';
import { MockPrismaService } from './utils/mock-prisma.service';

describe('AccountsEventListener', () => {
  let repository: AccountsRepository;
  let listener: AccountsEventListener;
  let configService: ConfigService;

  beforeEach(() => {
    const prisma = new MockPrismaService();
    repository = new AccountsRepository(prisma as any);

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        switch (key) {
          case 'indexerUrl':
            return 'https://api.testnet.aptoslabs.com/v1/graphql';
          case 'ingestion.pollingIntervalMs':
            return 10_000;
          case 'ingestion.pageSize':
            return 25;
          default:
            return defaultValue;
        }
      })
    } as unknown as ConfigService;

    listener = new AccountsEventListener(configService, repository);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('ingests registration events from indexer and updates repository cursor', async () => {
    const eventTimestamp = new Date('2024-06-10T12:00:00Z').toISOString();
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          events: [
            {
              transaction_version: '100',
              event_index: 0,
              type: '0xHAIGO::registry::SellerRegistered',
              data: {
                account: '0xabc',
                profile_hash: { value: 'a'.repeat(64) },
                profile_uri: 'ipfs://profile'
              },
              transaction_hash: '0xhash',
              account_address: '0xabc',
              transaction_timestamp: eventTimestamp
            }
          ]
        }
      })
    } as any);

    // Manually set cursor to start
    (listener as any).lastTxnVersion = BigInt(-1);
    (listener as any).lastEventIndex = BigInt(-1);

    await (listener as any).pollOnce();

    const stored = await repository.findByAddress('0xabc');
    expect(stored).not.toBeNull();
    expect(stored?.profileHashValue).toBe('a'.repeat(64));
    expect(fetchMock).toHaveBeenCalledWith('https://api.testnet.aptoslabs.com/v1/graphql', expect.anything());
    expect((listener as any).lastTxnVersion).toBe(BigInt(100));
    expect((listener as any).lastEventIndex).toBe(BigInt(0));
  });
});
