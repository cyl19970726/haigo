'use client';

import type { OrderDetailDto, OrderSummaryDto, WarehouseSummary } from '@shared/dto/orders';
import { type ApiEnvelope, buildUrl, extractData, parseJson } from './client';

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
