import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletContextValue } from '../../lib/wallet/context';
import { RegisterView } from './RegisterView';

declare const global: typeof globalThis & { fetch: ReturnType<typeof vi.fn> };

const mockUpload = vi.fn();
const mockFetchAccount = vi.fn();
const mockHashFile = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    pathname: '/register',
    route: '/register',
    query: {}
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/register'
}));

vi.mock('../../lib/api/registration', () => ({
  uploadIdentityDocument: (...args: Parameters<typeof mockUpload>) => mockUpload(...args),
  fetchAccountProfile: (...args: Parameters<typeof mockFetchAccount>) => mockFetchAccount(...args)
}));

vi.mock('../../lib/crypto/blake3', () => ({
  hashFileBlake3: (...args: Parameters<typeof mockHashFile>) => mockHashFile(...args)
}));

const transactionBuild = vi.fn(() => ({ mock: 'txn' }));
const transactionSimulate = vi.fn(async () => [
  {
    success: true,
    gas_used: '120',
    gas_unit_price: '1000',
    max_gas_amount: '1500',
    bytes: '256'
  }
]);
const transactionGetByHash = vi.fn(async () => ({ type: 'user_transaction', success: true }));
const signAndSubmit = vi.fn(async () => ({ hash: '0xabc123' }));

const mockPublicKey = `0x${'1'.repeat(64)}`;

const baseContext: WalletContextValue = {
  status: 'connected',
  accountAddress: '0x1',
  accountPublicKey: mockPublicKey,
  walletName: 'Test Wallet',
  availableWallets: [{ name: 'Test Wallet', icon: '', readyState: 'Installed' }],
  connect: vi.fn(),
  disconnect: vi.fn(),
  networkStatus: { expected: 'testnet', actual: 'testnet', isMatch: true, lastChecked: Date.now() },
  refreshNetworkStatus: vi.fn(),
  connectionError: undefined,
  aptos: {
    transaction: {
      build: {
        simple: transactionBuild
      },
      simulate: {
        simple: transactionSimulate
      },
      getTransactionByHash: transactionGetByHash
    }
  } as unknown as WalletContextValue['aptos'],
  signAndSubmitTransaction: signAndSubmit,
  signTransaction: vi.fn()
};

const contextRef: { current: WalletContextValue } = {
  current: baseContext
};

vi.mock('../../lib/wallet/context', () => ({
  useWalletContext: () => contextRef.current
}));

const resetMocks = () => {
  transactionBuild.mockClear();
  transactionSimulate.mockClear();
  transactionGetByHash.mockClear();
  signAndSubmit.mockClear();
  mockUpload.mockClear();
  mockFetchAccount.mockReset();
  mockHashFile.mockReset();
  contextRef.current = {
    ...baseContext,
    aptos: {
      transaction: {
        build: {
          simple: transactionBuild
        },
        simulate: {
          simple: transactionSimulate
        },
        getTransactionByHash: transactionGetByHash
      }
    } as unknown as WalletContextValue['aptos'],
    accountPublicKey: mockPublicKey
  };
};

beforeEach(() => {
  vi.useRealTimers();
  vi.stubEnv('NEXT_PUBLIC_APTOS_NETWORK', 'testnet');
  vi.stubEnv('NEXT_PUBLIC_APT_USD_RATE', '0');
  resetMocks();
  mockHashFile.mockResolvedValue('c'.repeat(64));
  mockUpload.mockResolvedValue({
    recordUid: '0x1',
    path: '/uploads/license.pdf',
    hash: { algo: 'blake3', value: 'c'.repeat(64) }
  });
  mockFetchAccount
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  sessionStorage.clear();
});

describe('RegisterView', () => {
  it('uploads documentation and displays stored metadata', async () => {
    const user = userEvent.setup();
    const view = render(<RegisterView />);

    await waitFor(() => expect(mockFetchAccount).toHaveBeenCalled());

    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['doc'], 'license.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);

    await waitFor(() => expect(mockHashFile).toHaveBeenCalled());

    const submitButton = screen.getByRole('button', { name: /upload & cache documentation/i });
    await user.click(submitButton);

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(await screen.findByText('/uploads/license.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh upload cache/i })).toBeInTheDocument();
  });

  it('simulates and submits registration, showing explorer link and success message', async () => {
    const user = userEvent.setup();
    const view = render(<RegisterView />);

    await waitFor(() => expect(mockFetchAccount).toHaveBeenCalled());

    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['doc'], 'license.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    await waitFor(() => expect(mockHashFile).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /upload & cache documentation/i }));
    await waitFor(() => screen.getByText('/uploads/license.pdf'));

    await user.click(screen.getByRole('button', { name: /estimate gas/i }));
    await waitFor(() => expect(transactionSimulate).toHaveBeenCalled());
    expect(await screen.findByText('Gas used')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sign & submit transaction/i }));
    await waitFor(() => expect(signAndSubmit).toHaveBeenCalled());
    await waitFor(() => expect(transactionGetByHash).toHaveBeenCalled());
    expect(await screen.findByRole('link', { name: /View on Aptos explorer/i })).toBeInTheDocument();
    expect(mockFetchAccount).toHaveBeenCalledTimes(2);
  });
});
