'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useWalletContext } from '../../lib/wallet/context';
import { logoutSession } from '../../lib/api/session';
import { useSessionProfile } from '../../lib/session/profile-context';

type SignOutButtonProps = {
  className?: string;
};

export function SignOutButton({ className }: SignOutButtonProps): JSX.Element {
  const router = useRouter();
  const { disconnect } = useWalletContext();
  const { clearLocalSession } = useSessionProfile();
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
      clearLocalSession();
      setWorking(false);
      router.push('/');
    }
  }, [clearLocalSession, disconnect, router, working]);

  return (
    <button
      type="button"
      aria-label="Sign out"
      onClick={() => void onSignOut()}
      disabled={working}
      className={cn(
        buttonVariants({ variant: 'outline', size: 'sm' }),
        'gap-1 font-medium',
        className
      )}
    >
      {working ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export default SignOutButton;
