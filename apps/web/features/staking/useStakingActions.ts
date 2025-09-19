'use client';

import { useState, useCallback } from 'react';
import { useWalletContext } from '@/lib/wallet/context';
import { APTOS_COIN_TYPE } from '@shared/config/aptos';

const MODULE = (process.env.NEXT_PUBLIC_APTOS_MODULE || '').trim();
const STAKE_FN = MODULE ? `${MODULE}::staking::stake` : '';
const UNSTAKE_FN = MODULE ? `${MODULE}::staking::unstake` : '';
const SET_FEE_FN = MODULE ? `${MODULE}::staking::set_storage_fee` : '';
const OCTA_PER_APT = 100_000_000; // 1 APT = 10^8 octa

export function useStakingActions() {
  const { signAndSubmitTransaction } = useWalletContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const assertModule = () => {
    if (!MODULE) throw new Error('NEXT_PUBLIC_APTOS_MODULE is not configured');
  };

  const stake = useCallback(async (amountApt: number) => {
    assertModule();
    setSubmitting(true); setError(null); setLastHash(null);
    try {
      const amount = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
      const result = await signAndSubmitTransaction({
        type: 'entry_function_payload',
        function: STAKE_FN,
        type_arguments: [APTOS_COIN_TYPE],
        arguments: [String(amount)]
      } as unknown as any);
      const hash = typeof result === 'string' ? result : (result as any)?.hash || (result as any)?.transactionHash || (result as any)?.txnHash || (result as any)?.result?.hash;
      if (hash) setLastHash(hash);
      return hash as string | undefined;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [signAndSubmitTransaction]);

  const unstake = useCallback(async (amountApt: number) => {
    assertModule();
    setSubmitting(true); setError(null); setLastHash(null);
    try {
      const amount = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
      const result = await signAndSubmitTransaction({
        type: 'entry_function_payload',
        function: UNSTAKE_FN,
        type_arguments: [APTOS_COIN_TYPE],
        arguments: [String(amount)]
      } as unknown as any);
      const hash = typeof result === 'string' ? result : (result as any)?.hash || (result as any)?.transactionHash || (result as any)?.txnHash || (result as any)?.result?.hash;
      if (hash) setLastHash(hash);
      return hash as string | undefined;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [signAndSubmitTransaction]);

  const setStorageFee = useCallback(async (feePerUnitBps: number) => {
    assertModule();
    setSubmitting(true); setError(null); setLastHash(null);
    try {
      const fee = Math.max(Math.round(feePerUnitBps), 0);
      const result = await signAndSubmitTransaction({
        type: 'entry_function_payload',
        function: SET_FEE_FN,
        type_arguments: [],
        arguments: [String(fee)]
      } as unknown as any);
      const hash = typeof result === 'string' ? result : (result as any)?.hash || (result as any)?.transactionHash || (result as any)?.txnHash || (result as any)?.result?.hash;
      if (hash) setLastHash(hash);
      return hash as string | undefined;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [signAndSubmitTransaction]);

  return { submitting, error, lastHash, stake, unstake, setStorageFee };
}

