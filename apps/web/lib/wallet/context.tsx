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
import { buildNetworkStatus, normalizeNetworkInput } from './network';

const EXPECTED_NETWORK = process.env.NEXT_PUBLIC_APTOS_NETWORK || 'testnet';

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
  signMessage: ReturnType<typeof useWallet>['signMessage'];
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const resolveNetwork = (): Network => {
  switch ((EXPECTED_NETWORK || '').toLowerCase()) {
    case 'mainnet':
      return Network.MAINNET;
    case 'testnet':
      return Network.TESTNET;
    case 'devnet':
      return Network.DEVNET;
    case 'local':
      return Network.LOCAL;
    default:
      return Network.TESTNET;
  }
};

const resolveExpectedNetwork = (): Network => normalizeNetworkInput(EXPECTED_NETWORK) ?? resolveNetwork();

const computeNetworkStatus = (params?: { name?: string | null; chainId?: number | null }): NetworkStatus => {
  const expected = resolveExpectedNetwork();
  const result = buildNetworkStatus({
    expected,
    actualName: params?.name,
    actualChainId: params?.chainId ?? null,
    lastChecked: Date.now()
  });
  return result;
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
    signTransaction,
    signMessage
  } = useWallet();

  const [connectionError, setConnectionError] = useState<string>();
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(() =>
    computeNetworkStatus({ name: network?.name, chainId: network?.chainId })
  );

  const aptos = useMemo(() => {
    const config = new AptosConfig({ network: resolveNetwork() });
    return new Aptos(config);
  }, []);

  useEffect(() => {
    setNetworkStatus(computeNetworkStatus({ name: network?.name, chainId: network?.chainId }));
  }, [network?.name, network?.chainId, connected]);

  const refreshNetworkStatus = useCallback(
    async (retries = 0): Promise<NetworkStatus> => {
      let attempt = 0;
      let status = computeNetworkStatus({ name: network?.name, chainId: network?.chainId });

      while (!status.actual && attempt < retries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
        status = computeNetworkStatus({ name: network?.name, chainId: network?.chainId });
      }

      setNetworkStatus(status);
      return status;
    },
    [network?.name, network?.chainId]
  );

  const connect = useCallback(
    async (walletName: string) => {
      setConnectionError(undefined);

      // 避免对已连接的钱包重复发起连接请求（Petra 会抛出 "wallet is already connected"）
      if (wallet?.name === walletName && connected) {
        return;
      }

      try {
        await rawConnect(walletName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to connect wallet';

        // 对已经连接的特殊报错视为非致命情况，直接忽略
        if (message?.toLowerCase().includes('already connected')) {
          return;
        }

        setConnectionError(message);
        throw error;
      }
    },
    [connected, rawConnect, wallet?.name]
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
    signTransaction,
    signMessage
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
