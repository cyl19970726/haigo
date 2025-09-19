'use client';

import type { StakingIntentDto } from '@shared/dto/staking';

type ApiEnvelope<T> = { data: T; meta?: { requestId?: string; source?: 'onchain' | 'cache' } };

const BFF_BASE = (process.env.NEXT_PUBLIC_BFF_URL || '').replace(/\/$/, '');
const buildUrl = (path: string) => (BFF_BASE ? `${BFF_BASE}${path}` : path);

export async function fetchStakingIntent(warehouseAddress: string): Promise<StakingIntentDto> {
  const res = await fetch(buildUrl(`/api/staking/${warehouseAddress}`), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (res.status === 404) {
    // return an empty payload for better UX; callers can decide how to render
    return { warehouseAddress, stakedAmount: '0', minRequired: '0', feePerUnit: 0 };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to load staking intent');
  }
  const payload = (await res.json()) as ApiEnvelope<StakingIntentDto> | StakingIntentDto;
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<StakingIntentDto>).data;
  }
  return payload as StakingIntentDto;
}

