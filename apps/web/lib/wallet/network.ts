import { Network } from '@aptos-labs/ts-sdk';

export interface NormalizedNetworkStatus {
  expected: string;
  actual?: string;
  isMatch: boolean;
  lastChecked: number;
  error?: string;
  chainId?: number;
}

const NETWORK_ALIASES: Record<string, Network> = {
  testnet: Network.TESTNET,
  'aptos testnet': Network.TESTNET,
  aptostestnet: Network.TESTNET,
  'test net': Network.TESTNET,
  mainnet: Network.MAINNET,
  'aptos mainnet': Network.MAINNET,
  aptosmainnet: Network.MAINNET,
  devnet: Network.DEVNET,
  'aptos devnet': Network.DEVNET,
  local: Network.LOCAL,
  'aptos local': Network.LOCAL,
  localhost: Network.LOCAL
};

export const NETWORK_CHAIN_IDS: Partial<Record<number, Network>> = {
  1: Network.MAINNET,
  2: Network.TESTNET,
  4: Network.DEVNET
};

function normalizeString(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeNetworkInput(value?: string | null, chainId?: number | null): Network | undefined {
  if (typeof chainId === 'number' && Number.isFinite(chainId)) {
    const mapped = NETWORK_CHAIN_IDS[chainId];
    if (mapped) {
      return mapped;
    }
  }
  if (!value) return undefined;
  const normalized = normalizeString(value);
  const mapped = NETWORK_ALIASES[normalized];
  if (mapped) return mapped;
  if (normalized.includes('test')) return Network.TESTNET;
  if (normalized.includes('main')) return Network.MAINNET;
  if (normalized.includes('dev')) return Network.DEVNET;
  if (normalized.includes('local')) return Network.LOCAL;
  return undefined;
}

export function computeNetworkMatch(expected: Network, actual?: Network): boolean {
  if (!actual) return false;
  return expected === actual;
}

export function formatNetworkLabel(network?: Network | string | null): string {
  if (!network) return 'unknown';
  const net = typeof network === 'string' ? network.toLowerCase() : network;
  switch (net) {
    case Network.MAINNET:
    case 'mainnet':
      return 'mainnet';
    case Network.TESTNET:
    case 'testnet':
      return 'testnet';
    case Network.DEVNET:
    case 'devnet':
      return 'devnet';
    case Network.LOCAL:
    case 'local':
      return 'local';
    default:
      return String(network);
  }
}

export function buildNetworkStatus(params: {
  expected: Network;
  actualName?: string | null;
  actualChainId?: number | null;
  lastChecked: number;
}): NormalizedNetworkStatus {
  const { expected, actualName, actualChainId, lastChecked } = params;
  const normalizedExpected = expected;
  const normalizedActual = normalizeNetworkInput(actualName, actualChainId);
  return {
    expected: formatNetworkLabel(normalizedExpected),
    actual: formatNetworkLabel(normalizedActual ?? actualName ?? undefined),
    isMatch: computeNetworkMatch(normalizedExpected, normalizedActual),
    lastChecked,
    error: normalizedActual ? undefined : 'Wallet network unavailable',
    chainId: actualChainId ?? undefined
  };
}
