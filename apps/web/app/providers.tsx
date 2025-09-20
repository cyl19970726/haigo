'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletContextProvider } from '../lib/wallet/context';
import { SessionProfileProvider } from '../lib/session/profile-context';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WalletContextProvider>
        <SessionProfileProvider>{children}</SessionProfileProvider>
      </WalletContextProvider>
    </QueryClientProvider>
  );
}
