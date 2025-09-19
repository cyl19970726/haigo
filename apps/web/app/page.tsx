'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletContext } from '../lib/wallet/context';
import { useAccountRegistration } from '../lib/hooks/useAccountRegistration';
import { NetworkGuard } from '../lib/wallet/network-guard';
import { ensureSession as ensureSessionLogin } from '../lib/session/ensureSession';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

export default function LandingPage() {
  const router = useRouter();
  const {
    status,
    accountAddress,
    accountPublicKey,
    availableWallets,
    connect,
    connectionError,
    networkStatus,
    refreshNetworkStatus,
    signMessage
  } = useWalletContext();

  const { state: registrationState, check, reset, cancel, config } = useAccountRegistration({
    attempts: 3,
    initialDelayMs: 1000,
    backoffFactor: 3
  });

  const [announce, setAnnounce] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const redirectRef = useRef(false);
  const maxAttempts = config.attempts;

  const isProcessing = registrationState.status === 'checking' || registrationState.status === 'waiting';
  const disableConnect = status === 'connecting' || isProcessing;
  const disableRegister = isProcessing;
  const errorMessage = sessionError ?? (registrationState.status === 'error' ? registrationState.error : null);
  const showRetryButton =
    Boolean(accountAddress) && (['error', 'unregistered'].includes(registrationState.status) || Boolean(sessionError));

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (registrationState.status === 'checking') {
      setAnnounce('Checking registration status…');
    } else if (registrationState.status === 'waiting') {
      const attempt = Math.min(registrationState.attempts + 1, maxAttempts);
      setAnnounce(`Waiting for registration data (attempt ${attempt} of ${maxAttempts}).`);
    }
  }, [registrationState.status, registrationState.attempts, maxAttempts]);

  const ensureSession = useCallback(
    async (address: string) => {
      return ensureSessionLogin(address, signMessage ?? undefined, accountPublicKey);
    },
    [signMessage, accountPublicKey]
  );

  useEffect(() => {
    if (!accountAddress) {
      cancel();
      reset();
      redirectRef.current = false;
      setAnnounce(null);
      setSessionError(null);
      return;
    }

    redirectRef.current = false;
    setAnnounce('Wallet connected. Checking registration status…');
    setSessionError(null);

    let active = true;

    void (async () => {
      const result = await check(accountAddress);
      if (!active) {
        return;
      }

      if (result.status === 'registered' && result.profile) {
        if (!redirectRef.current) {
          try {
            await ensureSession(result.profile.address);
            redirectRef.current = true;
            setAnnounce('Welcome back! Redirecting to your dashboard…');
            const path = result.profile.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse';
            router.push(path);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to establish session';
            setSessionError(message);
            setAnnounce(null);
            redirectRef.current = false;
          }
        }
      } else if (result.status === 'unregistered') {
        setAnnounce('No registration found for this wallet. You can register to continue.');
      } else if (result.status === 'error') {
        setAnnounce(null);
      }
    })();

    return () => {
      active = false;
      cancel();
    };
  }, [accountAddress, cancel, check, ensureSession, reset, router]);

  const statusMessage = useMemo(() => {
    switch (registrationState.status) {
      case 'checking':
        return 'Checking registration status…';
      case 'waiting': {
        const attempt = Math.min(registrationState.attempts + 1, maxAttempts);
        return `Waiting for registration data (attempt ${attempt} of ${maxAttempts}). Indexer updates can take up to 60 seconds.`;
      }
      case 'registered':
        return 'Registration confirmed. Redirecting you now…';
      case 'unregistered':
        return 'No registration found. If you just registered, retry the lookup; otherwise continue to register your identity.';
      default:
        return null;
    }
  }, [registrationState.status, registrationState.attempts, maxAttempts]);

  const handleRetry = () => {
    if (!accountAddress) return;
    cancel();
    setAnnounce('Retrying registration lookup…');
    setSessionError(null);
    void check(accountAddress);
  };

  // 登录通过 Connect Wallet 完成，无需单独 Sign in 入口

  const networkMismatchFallback = (
    <section className="landing-hero text-center" role="alert">
      <h1 className="landing-hero__headline">Switch to {networkStatus.expected}</h1>
      <p className="landing-hero__subcopy">
        Your wallet is currently on {networkStatus.actual ?? 'an unknown network'}. Switch networks in your wallet and retry to continue.
      </p>
      <div className="landing-hero__actions">
        <Button onClick={() => void refreshNetworkStatus(3)}>Retry network check</Button>
      </div>
    </section>
  );

  return (
    <main className="min-h-screen">
      <NetworkGuard fallback={networkMismatchFallback}>
        <>
          <section className="landing-hero text-center">
            <h1 className="landing-hero__headline">Verifiable storage & logistics for cross‑border commerce</h1>
            <p className="landing-hero__subcopy">
              Indexer‑backed proofs, transparent lifecycle, and reliable storage partners — connect your wallet to get started.
            </p>
            <div className="landing-hero__actions">
              {availableWallets.length === 0 ? (
                <Button disabled>Install an Aptos wallet to continue</Button>
              ) : (
                <Button
                  disabled={disableConnect}
                  onClick={() => {
                    // 选择优先钱包：Petra > Martian > 其他（已安装优先）
                    const byPriority = (names: string[]) =>
                      names
                        .map((n) => availableWallets.find((w) => w.name.toLowerCase().includes(n)))
                        .filter(Boolean) as typeof availableWallets;
                    const installed = availableWallets.filter((w) => (w.readyState || '').toLowerCase().includes('installed'));
                    const [choice] = [
                      ...byPriority(['petra', 'martian']),
                      ...(installed.length ? installed : availableWallets)
                    ];
                    if (choice) void connect(choice.name);
                  }}
                >
                  {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
                </Button>
              )}
              <Button variant="secondary" disabled={disableRegister} onClick={() => router.push('/register')}>
                Register Identity
              </Button>
              {/* 登录通过 Connect Wallet 完成，不额外提供 Sign in 按钮 */}
              {showRetryButton && (
                <Button variant="outline" disabled={isProcessing} onClick={handleRetry}>
                  Retry lookup
                </Button>
              )}
            </div>
            {connectionError && (
              <p role="alert" className="mt-4 text-red-600">
                {connectionError}
              </p>
            )}
            {errorMessage && (
              <div role="alert" className="mt-2 text-red-600">
                <p>{errorMessage}</p>
                {errorMessage.toLowerCase().includes('did not return a login signature') && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    The wallet dialog may have been closed or blocked. Click "Connect Wallet" again to retry signature.
                  </p>
                )}
              </div>
            )}
            {statusMessage && (
              <p className="mt-3 text-sm text-muted-foreground">{statusMessage}</p>
            )}
          </section>

          <section className="value-grid" aria-label="Key values">
            <Card>
              <CardHeader>
                <CardTitle>Verifiable Storage</CardTitle>
                <CardDescription>Evidence hashed and tracked on‑chain to ensure integrity.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Transparent Logistics</CardTitle>
                <CardDescription>Lifecycle events captured with timestamps and transaction hashes.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Insurance & Claims</CardTitle>
                <CardDescription>Designed for reliable coverage and dispute transparency.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Indexer‑Backed Proofs</CardTitle>
                <CardDescription>Efficient ingestion with backoff and retry for resilience.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Low‑Friction Onboarding</CardTitle>
                <CardDescription>Connect wallet, register once, and start creating orders.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Analytics Ready</CardTitle>
                <CardDescription>Data streams mapped for dashboards and ops monitoring.</CardDescription>
              </CardHeader>
            </Card>
          </section>

          <section className="how-steps" aria-label="How it works">
            <div className="how-steps__item">① Connect</div>
            <div className="how-steps__item">② Register</div>
            <div className="how-steps__item">③ Create Order</div>
            <div className="how-steps__item">④ Track & Verify</div>
          </section>

          <section className="metrics-band" aria-label="Network metrics">
            <p>1,245 Orders • 32 Warehouses • 99.9% Uptime</p>
          </section>

          <footer className="site-footer text-center" aria-label="Footer">
            <p>
              © HaiGo • <a href="/docs">Docs</a> • <a href="/privacy">Privacy</a> • <a href="/contact">Contact</a>
            </p>
          </footer>
        </>
      </NetworkGuard>

      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', left: -9999 }}>
        {announce ?? ''}
      </div>
    </main>
  );
}
