import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { DirectoryRepository, type DirectoryListOptions } from '../src/modules/directory/directory.repository.js';
import type { HasuraWarehouseProfile } from '../src/modules/directory/hasura.client.js';

const lower = (value: string) => value.toLowerCase();

class StubPrismaService {
  constructor(
    private readonly data: {
      accounts: Array<{
        accountAddress: string;
        profileUri?: string | null;
        chainTimestamp: Date;
      }>;
      positions: Array<{
        warehouseAddress: string;
        stakedAmount: bigint;
        updatedAt?: Date;
      }>;
      fees: Array<{
        warehouseAddress: string;
        feePerUnit: number;
        updatedAt?: Date;
      }>;
    }
  ) {}

  account = {
    findMany: async ({ where }: { where: any }): Promise<any[]> => {
      const q: string | undefined = where?.OR?.[0]?.accountAddress?.contains ?? where?.OR?.[1]?.profileUri?.contains;
      return this.data.accounts
        .filter((account) => account)
        .filter((account) => !q || account.accountAddress.includes(q) || (account.profileUri ?? '').includes(q))
        .map((account) => ({
          accountAddress: account.accountAddress,
          profileUri: account.profileUri ?? null,
          chainTimestamp: account.chainTimestamp
        }));
    }
  };

  stakingPosition = {
    findMany: async ({ where }: { where: { warehouseAddress: { in: string[] } } }) => {
      const set = new Set(where.warehouseAddress.in.map(lower));
      return this.data.positions.filter((item) => set.has(lower(item.warehouseAddress)));
    }
  };

  storageFeeCache = {
    findMany: async ({ where }: { where: { warehouseAddress: { in: string[] } } }) => {
      const set = new Set(where.warehouseAddress.in.map(lower));
      return this.data.fees.filter((item) => set.has(lower(item.warehouseAddress)));
    }
  };
}

class StubHasuraClient {
  public calls = 0;
  constructor(private readonly payload: Record<string, HasuraWarehouseProfile>) {}
  async fetchWarehouseProfiles(addresses: string[]) {
    this.calls += 1;
    const map: Record<string, HasuraWarehouseProfile> = {};
    for (const address of addresses) {
      const profile = this.payload[address];
      if (profile) {
        map[address] = profile;
      }
    }
    return map;
  }
}

const createRepository = (
  options?: {
    hasura?: Record<string, HasuraWarehouseProfile>;
    accounts?: StubPrismaService['data']['accounts'];
    positions?: StubPrismaService['data']['positions'];
    fees?: StubPrismaService['data']['fees'];
    cacheTtlMs?: number;
  }
) => {
  const prisma = new StubPrismaService({
    accounts:
      options?.accounts ??
      [
        { accountAddress: '0xAAA1', profileUri: 'https://example.com/a?name=Alpha', chainTimestamp: new Date('2024-01-01T00:00:00Z') },
        { accountAddress: '0xBBB2', profileUri: null, chainTimestamp: new Date('2024-01-02T00:00:00Z') }
      ],
    positions:
      options?.positions ??
      [
        { warehouseAddress: '0xAAA1', stakedAmount: 5_000_000_000n, updatedAt: new Date('2024-02-01T00:00:00Z') },
        { warehouseAddress: '0xBBB2', stakedAmount: 500_000_000n, updatedAt: new Date('2024-02-02T00:00:00Z') }
      ],
    fees:
      options?.fees ??
      [
        { warehouseAddress: '0xAAA1', feePerUnit: 45, updatedAt: new Date('2024-02-03T00:00:00Z') },
        { warehouseAddress: '0xBBB2', feePerUnit: 55, updatedAt: new Date('2024-02-04T00:00:00Z') }
      ]
  });

  const hasura = new StubHasuraClient(
    options?.hasura ?? {
      '0xaaa1': {
        name: 'Alpha Warehouse',
        creditScore: 87,
        creditCapacity: 1200,
        availability: 'available',
        serviceAreas: ['north-china'],
        mediaSamples: ['Cold storage']
      }
    }
  );

  const configService = {
    get: jest.fn((key: string) => (key === 'directory.cacheTtlMs' ? options?.cacheTtlMs ?? 1000 : undefined))
  } as unknown as { get: (key: string) => unknown };

  const repo = new DirectoryRepository(prisma as any, hasura as any, configService as any);
  return { repo, hasura };
};

const list = async (repo: DirectoryRepository, options: Partial<DirectoryListOptions> = {}) => {
  return repo.list({
    page: 1,
    pageSize: 20,
    ...options
  });
};

describe('DirectoryRepository', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('aggregates warehousing data and applies filters', async () => {
    const { repo } = createRepository();

    const result = await list(repo, { available: true, minScore: 50, maxFeeBps: 50, area: 'north-china', sort: 'score_desc' });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);

    const warehouse = result.items[0] as WarehouseSummary & { feePerUnit?: number };
    expect(warehouse.name).toBe('Alpha Warehouse');
    expect(warehouse.stakingScore).toBe(87);
    expect(warehouse.creditCapacity).toBe(1200);
    expect(warehouse.availability).toBe('available');
    expect(warehouse.serviceAreas).toEqual(['north-china']);
    expect(warehouse.feePerUnit).toBe(45);
  });

  it('caches repeated queries within TTL', async () => {
    const { repo, hasura } = createRepository({ cacheTtlMs: 60_000 });
    const first = await list(repo, { sort: 'fee_asc' });
    const second = await list(repo, { sort: 'fee_asc' });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(hasura.calls).toBe(1);
  });

  it('falls back gracefully when Hasura provides no data', async () => {
    const { repo } = createRepository({ hasura: {} });
    const result = await list(repo, { available: false });

    const warehouse = result.items.find((item) => item.address === '0xbbb2');
    expect(warehouse).toBeDefined();
    expect(warehouse?.name).toMatch(/Warehouse/i);
    expect(typeof warehouse?.stakingScore).toBe('number');
  });

  it('filters by q against Hasura name (post-aggregation)', async () => {
    const { repo } = createRepository();
    const result = await list(repo, { q: 'alpha' });
    expect(result.total).toBe(1);
    expect(result.items[0].address.toLowerCase()).toBe('0xaaa1');
  });

  it('filters by q against serviceAreas (post-aggregation)', async () => {
    const { repo } = createRepository();
    const result = await list(repo, { q: 'north' });
    expect(result.total).toBe(1);
    expect(result.items[0].address.toLowerCase()).toBe('0xaaa1');
  });

  it('returns empty when q has no matches', async () => {
    const { repo } = createRepository();
    const result = await list(repo, { q: 'no-such-term' });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});
