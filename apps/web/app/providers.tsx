'use client';

import type { ReactNode } from 'react';
import { WalletContextProvider } from '../lib/wallet/context';

export function Providers({ children }: { children: ReactNode }) {
  return <WalletContextProvider>{children}</WalletContextProvider>;
}
