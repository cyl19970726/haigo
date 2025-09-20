'use client';

import type { WarehouseSummary } from '@shared/dto/orders';
import { buildUrl, parseJson } from './client';

export type DirectorySort = 'score_desc' | 'fee_asc' | 'capacity_desc' | 'recent';

export interface DirectoryFilters {
  available?: boolean;
  minScore?: number;
  maxFeeBps?: number;
  area?: string;
  q?: string;
  sort?: DirectorySort;
  page?: number;
  pageSize?: number;
}

export interface DirectoryResponse {
  items: WarehouseSummary[];
  total: number;
  page: number;
  pageSize: number;
  cacheHit: boolean;
  generatedAt?: string;
}

export const DEFAULT_DIRECTORY_PAGE_SIZE = 12;

export async function fetchWarehouseDirectory(
  filters: DirectoryFilters,
  signal?: AbortSignal
): Promise<DirectoryResponse> {
  const params = new URLSearchParams();
  if (filters.available !== undefined) {
    params.set('available', String(filters.available));
  }
  if (typeof filters.minScore === 'number' && Number.isFinite(filters.minScore)) {
    params.set('minScore', String(filters.minScore));
  }
  if (typeof filters.maxFeeBps === 'number' && Number.isFinite(filters.maxFeeBps)) {
    params.set('maxFeeBps', String(filters.maxFeeBps));
  }
  if (filters.area) {
    params.set('area', filters.area);
  }
  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.sort) {
    params.set('sort', filters.sort);
  }
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_DIRECTORY_PAGE_SIZE;
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  const response = await fetch(buildUrl(`/api/warehouses?${params.toString()}`), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to load warehouse directory');
  }

  type Envelope = {
    data?: WarehouseSummary[];
    meta?: {
      page?: number;
      pageSize?: number;
      total?: number;
      cacheHit?: boolean;
      generatedAt?: string;
    };
  };

  const payload = await parseJson<Envelope | WarehouseSummary[]>(response);

  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const meta = Array.isArray(payload)
    ? {}
    : payload?.meta ?? {};

  return {
    items,
    total: typeof meta.total === 'number' ? meta.total : items.length,
    page: typeof meta.page === 'number' ? meta.page : page,
    pageSize: typeof meta.pageSize === 'number' ? meta.pageSize : pageSize,
    cacheHit: Boolean(meta.cacheHit),
    generatedAt: meta.generatedAt
  };
}
