import { OrdersController } from '../src/modules/orders/orders.controller.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';

class MockOrdersService extends OrdersService {
  constructor() {
    // @ts-expect-error allow undefined repo in mock parent
    super(undefined);
  }
  async createDraft(): Promise<any> {
    return { recordUid: 'draft-123', signPayload: { function: '0x::orders::create_order', typeArguments: [], functionArguments: [] } };
  }
  async listSummaries(): Promise<any[]> { return []; }
  async getDetail(): Promise<any | null> { return null; }
}

describe('OrdersController', () => {
  let controller: OrdersController;

  beforeEach(() => {
    controller = new OrdersController(new MockOrdersService() as any);
  });

  it('returns recordUid on draft creation', async () => {
    const res = await controller.createDraft({
      sellerAddress: '0x1',
      warehouseAddress: '0x2',
      inboundLogistics: null,
      pricing: { amountSubunits: 1, insuranceFeeSubunits: 0, platformFeeSubunits: 0, currency: 'APT' },
      initialMedia: null
    } as any);
    expect(res.recordUid).toBe('draft-123');
  });
});
