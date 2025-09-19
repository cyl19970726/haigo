'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletContext } from '../../lib/wallet/context';
import { logoutSession } from '../../lib/api/session';

export function SignOutButton(): JSX.Element {
  const router = useRouter();
  const { disconnect } = useWalletContext();
  const [working, setWorking] = useState(false);

  const onSignOut = useCallback(async () => {
    if (working) return;
    setWorking(true);
    try {
      try {
        await logoutSession();
      } catch {}
      try {
        await disconnect();
      } catch {}
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage?.clear?.();
          window.localStorage?.removeItem?.('haigo:orders:create');
        }
      } catch {}
    } finally {
      setWorking(false);
      router.push('/');
    }
  }, [disconnect, router, working]);

  return (
    <button
      type="button"
      aria-label="Sign out"
      onClick={() => void onSignOut()}
      disabled={working}
      className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-60"
    >
      {working ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export default SignOutButton;

