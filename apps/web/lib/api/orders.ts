'use client';

import type { OrderDetailDto, OrderSummaryDto, WarehouseSummary } from '@shared/dto/orders';

interface ApiMeta {
  requestId?: string;
  timestamp?: string;
}

interface ApiEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}

const BFF_BASE = (process.env.NEXT_PUBLIC_BFF_URL || '').replace(/\/$/, '');

const buildUrl = (path: string) => {
  if (!BFF_BASE) return path;
  return `${BFF_BASE}${path}`;
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const bodyText = await response.text();
  if (!bodyText) {
    return {} as T;
  }
  return JSON.parse(bodyText) as T;
};

const extractData = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

export async function fetchWarehouses(): Promise<WarehouseSummary[]> {
  const response = await fetch(buildUrl('/api/warehouses'), {
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

export async function fetchOrderSummaries(): Promise<OrderSummaryDto[]> {
  const response = await fetch(buildUrl('/api/orders'), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to refresh orders');
  }

  const body = await parseJson<ApiEnvelope<OrderSummaryDto[]> | OrderSummaryDto[]>(response);
  const data = extractData(body);
  return Array.isArray(data) ? data : [];
}
