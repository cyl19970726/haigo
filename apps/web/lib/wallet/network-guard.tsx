'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useWalletContext } from './context';

interface NetworkGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * NetworkGuard ensures the connected wallet network matches NEXT_PUBLIC_APTOS_NETWORK.
 * When mismatched, it renders the provided fallback (or a default message) and disables children.
 */
export function NetworkGuard({ children, fallback }: NetworkGuardProps) {
  const { networkStatus, refreshNetworkStatus } = useWalletContext();

  useEffect(() => {
    refreshNetworkStatus(2);
    const handler = () => {
      void refreshNetworkStatus(1);
    };

    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [refreshNetworkStatus]);

  if (!networkStatus.isMatch) {
    if (fallback) {
      return <>{fallback}</>;
    }

    const actualLabel = networkStatus.actual ? networkStatus.actual : 'unknown';
    return (
      <div className="haigo-network-guard">
        <h2>Switch Aptos Network</h2>
        <p>
          Your wallet is currently on <strong>{actualLabel}</strong>, but this workspace expects
          <strong> {networkStatus.expected}</strong>. Switch networks in your wallet and click retry.
        </p>
        <button type="button" onClick={() => refreshNetworkStatus(3)}>
          Retry network check
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
