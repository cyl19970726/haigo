import { OrdersRepository } from '../src/modules/orders/orders.repository.js';

class MockOrdersPrismaService {
  orders = new Map<string, any>();
  orderEvents: Array<any> = [];

  order = {
    create: async ({ data }: { data: any }) => {
      this.orders.set(data.recordUid, { ...data });
      return { ...data };
    },
    upsert: async ({ where, create, update }: { where: any; create: any; update: any }) => {
      const key = where.recordUid;
      if (!this.orders.has(key)) {
        this.orders.set(key, { ...create });
        return { ...create };
      }
      const next = { ...(this.orders.get(key) as any), ...update };
      this.orders.set(key, next);
      return next;
    },
    findMany: async ({ where }: { where?: any }) => {
      const list = Array.from(this.orders.values());
      if (!where) return list;
      return list.filter((o) => {
        if (where.creatorAddress) return o.creatorAddress === where.creatorAddress;
        return true;
      });
    },
    findUnique: async ({ where }: { where: any }) => {
      return (where?.recordUid && this.orders.get(where.recordUid)) || null;
    }
  };

  orderEvent = {
    upsert: async ({ where, create }: { where: any; create: any }) => {
      const existing = this.orderEvents.find(
        (e) => e.txnVersion === create.txnVersion && e.eventIndex === create.eventIndex
      );
      if (!existing) this.orderEvents.push({ ...create });
      return existing ?? create;
    }
  };

  mediaAsset = {
    findMany: async ({ where }: { where: any }) => {
      // No media mocked for repository-unit scope
      return [] as any[];
    }
  };
}

describe('OrdersRepository', () => {
  let prisma: MockOrdersPrismaService;
  let repo: OrdersRepository;

  beforeEach(() => {
    prisma = new MockOrdersPrismaService();
    repo = new OrdersRepository(prisma as any);
  });

  it('creates a draft with status ORDER_DRAFT', async () => {
    const recordUid = await repo.createDraft({
      sellerAddress: '0x1',
      warehouseAddress: '0x2',
      inboundLogistics: 'TRACK-1',
      pricing: { amountSubunits: 10, insuranceFeeSubunits: 1, platformFeeSubunits: 1, currency: 'APT' },
      initialMedia: null
    });
    expect(recordUid).toMatch(/draft-/);
    const created = await prisma.order.findUnique({ where: { recordUid } });
    expect(created?.status).toBe('ORDER_DRAFT');
  });

  it('upserts ONCHAIN_CREATED from OrderCreated event', async () => {
    await repo.upsertOnchainCreated({
      txnVersion: BigInt(100),
      eventIndex: BigInt(0),
      txnHash: '0xabc',
      chainTimestamp: new Date(),
      orderId: 42,
      seller: '0x1',
      warehouse: '0x2',
      logisticsInbound: 'TRACK-1',
      pricing: { amount: 10, insuranceFee: 1, platformFee: 1, total: 12 }
    });
    const uid = 'order-42-abc';
    const created = await prisma.order.findUnique({ where: { recordUid: uid } });
    expect(created?.status).toBe('ONCHAIN_CREATED');
  });
});
