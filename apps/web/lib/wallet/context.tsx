'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { AptosWalletAdapterProvider, useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const EXPECTED_NETWORK = (process.env.NEXT_PUBLIC_APTOS_NETWORK || 'testnet').toLowerCase();

export type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface NetworkStatus {
  expected: string;
  actual?: string;
  isMatch: boolean;
  lastChecked: number;
  error?: string;
}

export interface WalletContextValue {
  status: WalletConnectionStatus;
  accountAddress?: string;
  accountPublicKey?: string;
  walletName?: string;
  availableWallets: { name: string; icon: string; readyState?: string }[];
  connect: (walletName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  networkStatus: NetworkStatus;
  refreshNetworkStatus: (retries?: number) => Promise<NetworkStatus>;
  connectionError?: string;
  aptos: Aptos;
  signAndSubmitTransaction: ReturnType<typeof useWallet>['signAndSubmitTransaction'];
  signTransaction: ReturnType<typeof useWallet>['signTransaction'];
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const resolveNetwork = (): Network => {
  switch (EXPECTED_NETWORK) {
    case 'mainnet':
      return Network.MAINNET;
    case 'testnet':
      return Network.TESTNET;
    case 'devnet':
      return Network.DEVNET;
    case 'local':
      return Network.LOCAL;
    default:
      return Network.DEVNET;
  }
};

const computeNetworkStatus = (actual?: string | null): NetworkStatus => {
  const normalizedActual = actual?.toLowerCase();
  return {
    expected: EXPECTED_NETWORK,
    actual: normalizedActual,
    isMatch: Boolean(normalizedActual && normalizedActual === EXPECTED_NETWORK),
    lastChecked: Date.now(),
    error: normalizedActual ? undefined : 'Wallet network unavailable'
  };
};

const WalletContextBridge = ({ children }: { children: ReactNode }) => {
  const {
    account,
    connect: rawConnect,
    disconnect: rawDisconnect,
    connected,
    isLoading,
    wallet,
    wallets,
    network,
    signAndSubmitTransaction,
    signTransaction
  } = useWallet();

  const [connectionError, setConnectionError] = useState<string>();
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(() => computeNetworkStatus(network?.name));

  const aptos = useMemo(() => {
    const config = new AptosConfig({ network: resolveNetwork() });
    return new Aptos(config);
  }, []);

  useEffect(() => {
    setNetworkStatus(computeNetworkStatus(network?.name));
  }, [network?.name, connected]);

  const refreshNetworkStatus = useCallback(
    async (retries = 0): Promise<NetworkStatus> => {
      let attempt = 0;
      let status = computeNetworkStatus(network?.name);

      while (!status.actual && attempt < retries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
        status = computeNetworkStatus(network?.name);
      }

      setNetworkStatus(status);
      return status;
    },
    [network?.name]
  );

  const connect = useCallback(
    async (walletName: string) => {
      setConnectionError(undefined);
      try {
        await rawConnect(walletName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to connect wallet';
        setConnectionError(message);
        throw error;
      }
    },
    [rawConnect]
  );

  const disconnect = useCallback(async () => {
    setConnectionError(undefined);
    await rawDisconnect();
    setNetworkStatus(computeNetworkStatus(undefined));
  }, [rawDisconnect]);

  const status: WalletConnectionStatus = isLoading ? 'connecting' : connected ? 'connected' : 'disconnected';

  const availableWallets = useMemo(
    () =>
      wallets.map((item) => ({
        name: item.name,
        icon: item.icon ?? '',
        readyState: item.readyState
      })),
    [wallets]
  );

  const value: WalletContextValue = {
    status,
    accountAddress: account?.address?.toString(),
    accountPublicKey: account?.publicKey?.toString(),
    walletName: wallet?.name,
    availableWallets,
    connect,
    disconnect,
    networkStatus,
    refreshNetworkStatus,
    connectionError,
    aptos,
    signAndSubmitTransaction,
    signTransaction
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const WalletContextProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AptosWalletAdapterProvider
      autoConnect
      dappConfig={{ network: resolveNetwork() }}
      onError={(error) => console.error('[WalletAdapter]', error)}
    >
      <WalletContextBridge>{children}</WalletContextBridge>
    </AptosWalletAdapterProvider>
  );
};

export const useWalletContext = (): WalletContextValue => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within WalletContextProvider');
  }
  return context;
};
