import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignOutButton } from './SignOutButton';

vi.mock('../../lib/wallet/context', async (orig) => {
  const mod = await (orig as any)();
  return {
    ...mod,
    useWalletContext: () => ({ disconnect: vi.fn().mockResolvedValue(undefined) })
  };
});

vi.mock('../../lib/api/session', async (orig) => {
  const mod = await (orig as any)();
  return {
    ...mod,
    logoutSession: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('next/navigation', async (orig) => {
  const mod = await (orig as any)();
  return {
    ...mod,
    useRouter: () => ({ push: vi.fn() })
  };
});

describe('SignOutButton', () => {
  beforeEach(() => {
    // @ts-expect-error allow write
    global.sessionStorage = {
      clear: vi.fn()
    } as any;
    // @ts-expect-error allow write
    global.localStorage = {
      removeItem: vi.fn()
    } as any;
  });

  it('renders and triggers logout flow', async () => {
    render(<SignOutButton />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
  });
});

