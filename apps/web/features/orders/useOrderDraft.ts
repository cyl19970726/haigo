'use client';
import { useCallback, useState } from 'react';
import type { PricingBreakdown } from '@shared/dto/orders';
import { buildUrl, parseJson } from '../../lib/api/client';

export function useOrderDraft() {
  const [recordUid, setRecordUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createDraft = useCallback(async (input: {
    sellerAddress: string;
    warehouseAddress: string;
    inboundLogistics?: string | null;
    pricing: PricingBreakdown;
    initialMedia?: { category: string; hashValue: string } | null;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl('/api/orders/drafts'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!res.ok) {
        const body = await parseJson<{ message?: string }>(res);
        throw new Error(body?.message || 'Draft creation failed');
      }
      const body = await parseJson<{ recordUid?: string }>(res);
      const uid = body?.recordUid ?? null;
      setRecordUid(uid);
      return uid;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { recordUid, loading, error, createDraft };
}

