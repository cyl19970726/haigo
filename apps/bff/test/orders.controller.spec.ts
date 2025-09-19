import { OrdersController } from '../src/modules/orders/orders.controller.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import type { ListSummariesResult } from '../src/modules/orders/types/list-summaries.js';

class MockOrdersService extends OrdersService {
  constructor() {
    // @ts-expect-error allow undefined repo in mock parent
    super(undefined);
  }
  async createDraft(): Promise<any> {
    return { recordUid: 'draft-123', signPayload: { function: '0x::orders::create_order', typeArguments: [], functionArguments: [] } };
  }
  async listSummaries(): Promise<ListSummariesResult> {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  async getDetail(): Promise<any | null> { return null; }
}

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: MockOrdersService;
  let metricsStub: { recordOrdersInboxRequest: jest.Mock; recordOrdersInboxError: jest.Mock };

  beforeEach(() => {
    service = new MockOrdersService();
    metricsStub = {
      recordOrdersInboxRequest: jest.fn(),
      recordOrdersInboxError: jest.fn()
    };
    controller = new OrdersController(service as any, metricsStub as any);
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

  it('normalizes query params and records metrics on list', async () => {
    const listSpy = jest
      .spyOn(service, 'listSummaries')
      .mockResolvedValue({ items: [], total: 3, page: 2, pageSize: 50 });

    const response = await controller.list({
      warehouse: '0xABCDEF',
      status: 'created',
      page: '2',
      pageSize: '120'
    });

    expect(listSpy).toHaveBeenCalledWith({
      sellerAddress: undefined,
      warehouseAddress: '0xabcdef',
      status: 'CREATED',
      page: 2,
      pageSize: 100
    });
    expect(metricsStub.recordOrdersInboxRequest).toHaveBeenCalledTimes(1);
    expect(response.meta.page).toBe(2);
    expect(response.meta.total).toBe(3);
  });

  it('rejects conflicting seller and warehouse query', async () => {
    await expect(controller.list({ seller: '0x1', warehouse: '0x2' })).rejects.toThrow('Specify either seller or warehouse address');
    expect(metricsStub.recordOrdersInboxError).not.toHaveBeenCalled();
  });
});
