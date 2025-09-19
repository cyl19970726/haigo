import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { DirectoryController } from '../src/modules/directory/directory.controller.js';

const mockList = jest.fn();

const controller = new DirectoryController({
  list: mockList
} as unknown as any);

describe('DirectoryController', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('parses query parameters and delegates to service', async () => {
    const items: WarehouseSummary[] = [
      {
        id: '0x1',
        address: '0x1',
        name: 'Warehouse 1',
        stakingScore: 90,
        creditCapacity: 1000,
        availability: 'available'
      }
    ];

    mockList.mockResolvedValue({
      items,
      total: 1,
      page: 1,
      pageSize: 1,
      generatedAt: new Date(),
      cacheHit: false
    });

    const result = await controller.list({
      available: 'true',
      minScore: '50',
      maxFeeBps: '75',
      area: 'north',
      q: 'alpha',
      sort: 'fee_asc',
      page: '2',
      pageSize: '10'
    });

    expect(mockList).toHaveBeenCalledWith({
      available: true,
      minScore: 50,
      maxFeeBps: 75,
      area: 'north',
      q: 'alpha',
      sort: 'fee_asc',
      page: 2,
      pageSize: 10
    });

    expect(result.data).toEqual(items);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
  });

  it('applies defaults when query missing', async () => {
    mockList.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      generatedAt: new Date(),
      cacheHit: false
    });

    await controller.list({});

    expect(mockList).toHaveBeenCalledWith({
      available: undefined,
      minScore: undefined,
      maxFeeBps: undefined,
      area: undefined,
      q: undefined,
      sort: undefined,
      page: 1,
      pageSize: 20
    });
  });
});
