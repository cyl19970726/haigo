import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WarehouseSummary } from '@shared/dto/orders';
import { useWarehouseDirectory } from './useWarehouseDirectory';

declare const global: typeof globalThis & { fetch: ReturnType<typeof vi.fn> };

const mockFetchDirectory = vi.fn();

vi.mock('../../lib/api/directory', () => ({
  fetchWarehouseDirectory: (...args: Parameters<typeof mockFetchDirectory>) => mockFetchDirectory(...args),
  DEFAULT_DIRECTORY_PAGE_SIZE: 12
}));

const sampleWarehouses: WarehouseSummary[] = [
  {
    id: '0xA',
    address: '0xA',
    name: 'Alpha',
    stakingScore: 80,
    creditCapacity: 1000,
    availability: 'available',
    feePerUnit: 45
  }
];

describe('useWarehouseDirectory', () => {
  beforeEach(() => {
    mockFetchDirectory.mockReset();
    mockFetchDirectory.mockResolvedValue({
      items: sampleWarehouses,
      total: 1,
      page: 1,
      pageSize: 12,
      cacheHit: false,
      generatedAt: new Date().toISOString()
    });
  });

  it('loads directory data on mount', async () => {
    const { result } = renderHook(() => useWarehouseDirectory());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetchDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ available: true, page: 1, pageSize: 12 }),
      expect.any(AbortSignal)
    );

    expect(result.current.items).toEqual(sampleWarehouses);
    expect(result.current.total).toBe(1);
  });

  it('applies filter changes and resets pagination', async () => {
    const { result } = renderHook(() => useWarehouseDirectory());

    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetchDirectory.mockResolvedValueOnce({
      items: sampleWarehouses,
      total: 1,
      page: 1,
      pageSize: 12,
      cacheHit: true
    });

    result.current.updateFilters({ q: 'alpha', minScore: 70 });

    await waitFor(() => expect(mockFetchDirectory).toHaveBeenCalledTimes(2));
    expect(result.current.page).toBe(1);
    expect(mockFetchDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'alpha', minScore: 70, page: 1 }),
      expect.any(AbortSignal)
    );
  });
});
