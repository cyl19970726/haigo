import { AccountRole } from '@prisma/client';
import { AccountsRepository, AccountUpsertInput } from '../src/modules/accounts/accounts.repository.js';
import { MockPrismaService } from './utils/mock-prisma.service';

const createInput = (overrides: Partial<AccountUpsertInput> = {}): AccountUpsertInput => ({
  accountAddress: '0xabc',
  role: 'seller',
  profileHashValue: 'a'.repeat(64),
  profileUri: 'ipfs://profile',
  registeredBy: '0xabc',
  txnVersion: BigInt(1),
  eventIndex: BigInt(0),
  txnHash: '0xhash',
  chainTimestamp: new Date('2024-06-10T00:00:00Z'),
  ...overrides
});

describe('AccountsRepository', () => {
  let repository: AccountsRepository;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = new MockPrismaService();
    repository = new AccountsRepository(prisma as any);
  });

  it('creates a new account when none exists', async () => {
    const result = await repository.upsertFromEvent(createInput());
    expect(result.accountAddress).toBe('0xabc');
    const stored = await repository.findByAddress('0xabc');
    expect(stored).not.toBeNull();
    expect(stored?.profileHashValue).toBe('a'.repeat(64));
    expect(stored?.role).toBe(AccountRole.seller);
  });

  it('updates account when newer event arrives', async () => {
    await repository.upsertFromEvent(createInput());

    const updated = await repository.upsertFromEvent(
      createInput({
        profileHashValue: 'b'.repeat(64),
        txnVersion: BigInt(2),
        eventIndex: BigInt(1),
        profileUri: 'ipfs://new'
      })
    );

    expect(updated.profileHashValue).toBe('b'.repeat(64));
    expect(updated.txnVersion).toBe(BigInt(2));
    expect(updated.profileUri).toBe('ipfs://new');
  });

  it('skips outdated events based on txn_version and event_index', async () => {
    await repository.upsertFromEvent(createInput({ txnVersion: BigInt(5), eventIndex: BigInt(2) }));

    const result = await repository.upsertFromEvent(
      createInput({ txnVersion: BigInt(5), eventIndex: BigInt(1), profileHashValue: 'c'.repeat(64) })
    );

    expect(result.profileHashValue).toBe('a'.repeat(64));
  });

  it('returns latest processed event cursor', async () => {
    await repository.upsertFromEvent(createInput({ txnVersion: BigInt(3), eventIndex: BigInt(4) }));
    await repository.upsertFromEvent(createInput({ txnVersion: BigInt(8), eventIndex: BigInt(1) }));

    const cursor = await repository.getLatestProcessedEvent();
    expect(cursor).toEqual({ txnVersion: BigInt(8), eventIndex: BigInt(1) });
  });
});
