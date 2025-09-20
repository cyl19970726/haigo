'use client';

import { useState, useCallback } from 'react';
import { InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';
import { useWalletContext } from '@/lib/wallet/context';
import { APTOS_COIN_TYPE } from '@shared/config/aptos';

const MODULE = (process.env.NEXT_PUBLIC_APTOS_MODULE || '').trim();
const STAKE_FN = MODULE ? `${MODULE}::staking::stake` : '';
const UNSTAKE_FN = MODULE ? `${MODULE}::staking::unstake` : '';
const SET_FEE_FN = MODULE ? `${MODULE}::staking::set_storage_fee` : '';
const OCTA_PER_APT = 100_000_000; // 1 APT = 10^8 octa

export function useStakingActions() {
  const { accountAddress, signAndSubmitTransaction } = useWalletContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const assertModule = () => {
    if (!MODULE) throw new Error('NEXT_PUBLIC_APTOS_MODULE is not configured');
  };

  const submitPayload = useCallback(
    async (payload: InputGenerateTransactionPayloadData) => {
      assertModule();
      if (!accountAddress) {
        throw new Error('请先连接仓库钱包。');
      }

      setSubmitting(true);
      setError(null);
      setLastHash(null);

      try {
        const result = await signAndSubmitTransaction({
          sender: accountAddress,
          data: payload
        });
        const hash =
          typeof result === 'string'
            ? result
            : (result as any)?.hash ||
              (result as any)?.transactionHash ||
              (result as any)?.txnHash ||
              (result as any)?.result?.hash;
        if (hash) setLastHash(hash);
        return hash as string | undefined;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [accountAddress, signAndSubmitTransaction]
  );

  const stake = useCallback(async (amountApt: number) => {
    const amount = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
    const payload: InputGenerateTransactionPayloadData = {
      function: STAKE_FN,
      typeArguments: [APTOS_COIN_TYPE],
      functionArguments: [String(amount)]
    };
    return submitPayload(payload);
  }, [submitPayload]);

  const unstake = useCallback(async (amountApt: number) => {
    const amount = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
    const payload: InputGenerateTransactionPayloadData = {
      function: UNSTAKE_FN,
      typeArguments: [APTOS_COIN_TYPE],
      functionArguments: [String(amount)]
    };
    return submitPayload(payload);
  }, [submitPayload]);

  const setStorageFee = useCallback(async (feePerUnitBps: number) => {
    const fee = Math.max(Math.round(feePerUnitBps), 0);
    const payload: InputGenerateTransactionPayloadData = {
      function: SET_FEE_FN,
      typeArguments: [],
      functionArguments: [String(fee)]
    };
    return submitPayload(payload);
  }, [submitPayload]);

  return { submitting, error, lastHash, stake, unstake, setStorageFee };
}
