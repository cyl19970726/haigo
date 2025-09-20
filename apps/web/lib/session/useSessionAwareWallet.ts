'use client';

import { useMemo } from 'react';
import { useWalletContext } from '../wallet/context';
import { useSessionProfile } from './profile-context';

const normalizeAddress = (value?: string | null) => (value ? value.toLowerCase() : null);

export function useSessionAwareWallet() {
  const { sessionProfile } = useSessionProfile();
  const { accountAddress, status: walletStatus } = useWalletContext();

  const sessionAddress = useMemo(() => normalizeAddress(sessionProfile?.address), [sessionProfile?.address]);
  const walletAddress = useMemo(() => normalizeAddress(accountAddress), [accountAddress]);
  const activeAddress = sessionAddress ?? walletAddress ?? null;
  const hasMismatch = Boolean(sessionAddress && walletAddress && sessionAddress !== walletAddress);

  return {
    sessionProfile,
    sessionAddress,
    walletAddress,
    activeAddress,
    hasMismatch,
    walletStatus
  } as const;
}
