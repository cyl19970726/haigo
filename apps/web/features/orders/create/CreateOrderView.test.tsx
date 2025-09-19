import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderSummaryDto, WarehouseSummary } from '@shared/dto/orders';
import type { WalletContextValue } from '../../../lib/wallet/context';
import { CreateOrderView } from './CreateOrderView';

declare const global: typeof globalThis & { fetch: ReturnType<typeof vi.fn> };

const mockFetchWarehouses = vi.fn();
const mockFetchOrderDetail = vi.fn();
const mockFetchOrderSummaries = vi.fn();

const buildOrderSummariesResponse = (items: OrderSummaryDto[] = []) => ({
  data: items,
  meta: {
    page: 1,
    pageSize: Math.max(items.length, 1),
    total: items.length,
    generatedAt: new Date().toISOString(),
    filters: {}
  }
});

let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams
}));

vi.mock('../../../lib/api/orders', () => ({
  fetchWarehouses: (...args: Parameters<typeof mockFetchWarehouses>) => mockFetchWarehouses(...args),
  fetchOrderDetail: (...args: Parameters<typeof mockFetchOrderDetail>) => mockFetchOrderDetail(...args),
  fetchOrderSummaries: (...args: Parameters<typeof mockFetchOrderSummaries>) => mockFetchOrderSummaries(...args)
}));

const transactionBuild = vi.fn(() => ({ mock: 'txn' }));
const transactionSimulate = vi.fn(async () => [
  {
    success: true,
    gas_used: '210',
    gas_unit_price: '1000'
  }
]);
const transactionGetByHash = vi.fn(async () => ({
  type: 'user_transaction',
  success: true,
  events: [
    {
      type: '0xA11CE::orders::OrderCreated',
      data: { order_id: '123' }
    }
  ]
}));
const signAndSubmit = vi.fn(async () => ({ hash: '0xabc' }));

const walletContext: WalletContextValue = {
  status: 'connected',
  accountAddress: '0x1',
  accountPublicKey: `0x${'1'.repeat(64)}`,
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
  signTransaction: vi.fn(),
  signMessage: vi.fn()
};

const contextRef: { current: WalletContextValue } = {
  current: walletContext
};

vi.mock('../../../lib/wallet/context', () => ({
  useWalletContext: () => contextRef.current
}));

const resetMocks = () => {
  transactionBuild.mockClear();
  transactionSimulate.mockClear();
  transactionGetByHash.mockClear();
  signAndSubmit.mockClear();
  mockFetchWarehouses.mockReset();
  mockFetchOrderDetail.mockReset();
  mockFetchOrderSummaries.mockReset();
  searchParams = new URLSearchParams();
  contextRef.current = {
    ...walletContext,
    aptos: {
      transaction: {
        build: { simple: transactionBuild },
        simulate: { simple: transactionSimulate },
        getTransactionByHash: transactionGetByHash
      }
    } as unknown as WalletContextValue['aptos'],
    signMessage: vi.fn()
  };
};

beforeEach(() => {
  vi.useRealTimers();
  vi.stubEnv('NEXT_PUBLIC_APTOS_NETWORK', 'testnet');
  resetMocks();
  sessionStorage.clear();
  mockFetchWarehouses.mockResolvedValueOnce([
    {
      id: 'wh-1',
      address: '0xwh1',
      name: 'Alpha Warehouse',
      stakingScore: 88,
      creditCapacity: 1000,
      insuranceCoverage: 'Full coverage',
      availability: 'available',
      mediaSamples: ['Cold storage', 'Dehumidified']
    }
  ] as WarehouseSummary[]);
  mockFetchOrderDetail.mockResolvedValue(null);
  mockFetchOrderSummaries.mockResolvedValue(buildOrderSummariesResponse());
});

describe('CreateOrderView', () => {
  it('walks through the wizard and submits an order', async () => {
    const user = userEvent.setup();
    render(<CreateOrderView />);

    await waitFor(() => expect(mockFetchWarehouses).toHaveBeenCalled());
    expect(await screen.findByText(/Alpha Warehouse/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Use this warehouse/i }));
    expect(await screen.findByText(/Pricing configuration/i)).toBeInTheDocument();

    const amount = screen.getByLabelText(/Order amount/i) as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '2.5');
    await waitFor(() => expect(amount.value).toBe('2.5'));

    await user.click(screen.getByRole('button', { name: /Continue to review/i }));
    await waitFor(() =>
      expect(document.querySelector('.order-create-shell')?.getAttribute('data-step')).toBe('review')
    );

    await user.click(screen.getByRole('button', { name: /Estimate gas/i }));
    await waitFor(() => expect(transactionSimulate).toHaveBeenCalled());
    expect(await screen.findByText(/Gas estimate/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Sign & submit/i }));
    await waitFor(() => expect(signAndSubmit).toHaveBeenCalled());
    await waitFor(() => expect(transactionGetByHash).toHaveBeenCalled());

    expect(await screen.findByText(/Record UID/i)).toBeInTheDocument();
    expect(mockFetchOrderSummaries).toHaveBeenCalled();
  });

  it('shows network mismatch fallback and hides submission controls', async () => {
    contextRef.current = {
      ...walletContext,
      networkStatus: { expected: 'testnet', actual: 'devnet', isMatch: false, lastChecked: Date.now(), error: undefined }
    } as WalletContextValue;

    const user = userEvent.setup();
    render(<CreateOrderView />);

    await waitFor(() => expect(mockFetchWarehouses).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Use this warehouse/i }));
    await user.click(screen.getByRole('button', { name: /Continue to review/i }));

    expect(screen.getByRole('heading', { level: 2, name: /Switch Aptos Network/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign & submit/i })).not.toBeInTheDocument();
  });
});
