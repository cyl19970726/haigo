'use client';

import type { OrderDetailDto, OrderSummaryDto, WarehouseSummary } from '@shared/dto/orders';
import { type ApiEnvelope, buildUrl, extractData, parseJson } from './client';

export interface OrderSummariesFilters {
  sellerAddress?: string;
  warehouseAddress?: string;
  status?: OrderSummaryDto['status'];
  page?: number;
  pageSize?: number;
}

export interface OrderSummariesMeta {
  page: number;
  pageSize: number;
  total: number;
  generatedAt?: string;
  filters?: {
    sellerAddress?: string;
    warehouseAddress?: string;
    status?: OrderSummaryDto['status'];
  };
}

export interface OrderSummariesResponse {
  data: OrderSummaryDto[];
  meta: OrderSummariesMeta;
}

export async function fetchWarehouses(): Promise<WarehouseSummary[]> {
  // PoC: only fetch available warehouses for order creation flow
  const response = await fetch(buildUrl('/api/warehouses?available=true'), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to load warehouse directory');
  }

  const body = await parseJson<ApiEnvelope<WarehouseSummary[]> | WarehouseSummary[]>(response);
  const data = extractData(body);
  return Array.isArray(data) ? data : [];
}

export async function fetchOrderDetail(recordUid: string): Promise<OrderDetailDto | null> {
  const response = await fetch(buildUrl(`/api/orders/${encodeURIComponent(recordUid)}`), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to load order detail');
  }

  const body = await parseJson<ApiEnvelope<OrderDetailDto> | OrderDetailDto>(response);
  const data = extractData(body);
  return data ?? null;
}

export async function fetchOrderSummaries(filters: OrderSummariesFilters = {}): Promise<OrderSummariesResponse> {
  const params = new URLSearchParams();
  if (filters.sellerAddress) params.set('seller', filters.sellerAddress);
  if (filters.warehouseAddress) params.set('warehouse', filters.warehouseAddress);
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const query = params.toString();
  const response = await fetch(buildUrl(`/api/orders${query ? `?${query}` : ''}`), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to refresh orders');
  }

  const body = await parseJson<
    | (OrderSummariesResponse & { data: OrderSummaryDto[] })
    | ApiEnvelope<OrderSummaryDto[]>
    | OrderSummaryDto[]
  >(response);

  const fallbackMeta: OrderSummariesMeta = {
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
    total: 0,
    generatedAt: new Date().toISOString(),
    filters: {
      sellerAddress: filters.sellerAddress,
      warehouseAddress: filters.warehouseAddress,
      status: filters.status
    }
  };

  if (Array.isArray(body)) {
    return {
      data: body,
      meta: {
        ...fallbackMeta,
        pageSize: filters.pageSize ?? body.length,
        total: body.length
      }
    };
  }

  if ('data' in body) {
    const data = extractData(body);
    const envelopeMeta = (body as OrderSummariesResponse).meta as Partial<OrderSummariesMeta> | undefined;
    return {
      data: Array.isArray(data) ? data : [],
      meta: {
        ...fallbackMeta,
        ...(envelopeMeta ?? {}),
        filters: envelopeMeta?.filters ?? fallbackMeta.filters
      }
    };
  }

  return { data: [], meta: fallbackMeta };
}

export async function attachDraftTransaction(recordUid: string, txnHash: string): Promise<boolean> {
  const response = await fetch(buildUrl(`/api/orders/drafts/${encodeURIComponent(recordUid)}/attach-tx`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txnHash })
  });
  if (!response.ok) {
    return false;
  }
  return true;
}
