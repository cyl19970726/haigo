import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NetworkGuard } from './network-guard';

type MockContext = {
  networkStatus: {
    expected: string;
    actual?: string;
    isMatch: boolean;
    lastChecked: number;
  };
  refreshNetworkStatus: ReturnType<typeof vi.fn>;
};

const mockContext: MockContext = {
  networkStatus: {
    expected: 'testnet',
    actual: 'devnet',
    isMatch: false,
    lastChecked: Date.now()
  },
  refreshNetworkStatus: vi.fn()
};

vi.mock('./context', () => ({
  useWalletContext: () => mockContext
}));

describe('NetworkGuard', () => {
  beforeEach(() => {
    mockContext.networkStatus = {
      expected: 'testnet',
      actual: 'devnet',
      isMatch: false,
      lastChecked: Date.now()
    };
    mockContext.refreshNetworkStatus.mockClear();
  });

  it('shows fallback when network mismatch occurs', () => {
    render(
      <NetworkGuard fallback={<div>Switch network</div>}>
        <div>Protected content</div>
      </NetworkGuard>
    );

    expect(screen.getByText('Switch network')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders children when network matches', () => {
    mockContext.networkStatus = {
      expected: 'testnet',
      actual: 'testnet',
      isMatch: true,
      lastChecked: Date.now()
    };

    render(
      <NetworkGuard fallback={<div>Switch network</div>}>
        <div>Protected content</div>
      </NetworkGuard>
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});
