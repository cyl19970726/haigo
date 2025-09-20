import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '@shared/dto/registry';
import { useAuthSession } from '../useAuthSession';

const ensureSessionMock = vi.fn();

vi.mock('../../session/ensureSession', async () => {
  const actual = await vi.importActual<typeof import('../../session/ensureSession')>('../../session/ensureSession');
  return {
    ...actual,
    ensureSession: (...args: Parameters<typeof actual.ensureSession>) => ensureSessionMock(...args)
  };
});

const sampleProfile: AccountProfile = {
  address: '0x1',
  role: 'seller',
  profileHash: { algorithm: 'blake3', value: 'abc' },
  registeredAt: new Date().toISOString()
};

describe('useAuthSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions through states and stores profile on success', async () => {
    ensureSessionMock.mockImplementation(async (_address, _signMessage, _fallbackPublicKey, callbacks) => {
      callbacks?.onChallenge?.();
      callbacks?.onSigning?.();
      callbacks?.onVerifying?.();
      return sampleProfile;
    });

    const { result } = renderHook(() => useAuthSession());

    await act(async () => {
      await result.current.begin({ address: '0x1' });
    });

    expect(result.current.state.status).toBe('verified');
    expect(result.current.state.profile).toEqual(sampleProfile);
  });

  it('surfaces friendly error messages when signature is missing', async () => {
    ensureSessionMock.mockRejectedValue(new Error('Wallet did not return a login signature.'));

    const { result } = renderHook(() => useAuthSession());

    await act(async () => {
      await result.current.begin({ address: '0x2' });
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('No signature was returned');
  });

  it('maps fetch failed errors to backend offline hint and retries', async () => {
    ensureSessionMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sampleProfile);

    const { result } = renderHook(() => useAuthSession());

    await act(async () => {
      await result.current.begin({ address: '0x3' });
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Backend unavailable');

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.state.status).toBe('verified');
    expect(result.current.state.profile).toEqual(sampleProfile);
  });
});
