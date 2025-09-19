'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletContext } from '../lib/wallet/context';
import { fetchAccountProfile } from '../lib/api/registration';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

export default function LandingPage() {
  const router = useRouter();
  const { status, accountAddress, availableWallets, connect, connectionError } = useWalletContext();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (!accountAddress) return;
      setChecking(true);
      setError(null);
      setAnnounce('Wallet connected. Checking registration status…');
      try {
        const profile = await fetchAccountProfile(accountAddress);
        if (!mounted) return;
        if (profile) {
          setAnnounce('Welcome back! Redirecting to your dashboard…');
          router.push(profile.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse');
        } else {
          setAnnounce('No registration found. Redirecting to registration…');
          router.push('/register');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed.');
      } finally {
        setChecking(false);
      }
    }
    void check();
    return () => {
      mounted = false;
    };
  }, [accountAddress, router]);

  return (
    <main className="min-h-screen">
      <section className="landing-hero text-center">
        <h1 className="landing-hero__headline">Verifiable storage & logistics for cross‑border commerce</h1>
        <p className="landing-hero__subcopy">Indexer‑backed proofs, transparent lifecycle, and reliable storage partners — connect your wallet to get started.</p>
        <div className="landing-hero__actions">
          {availableWallets.map((w) => (
            <Button key={w.name} disabled={status === 'connecting' || checking} onClick={() => connect(w.name)}>
              {status === 'connecting' ? 'Connecting…' : `Connect ${w.name}`}
            </Button>
          ))}
          <Button variant="secondary" disabled={checking} onClick={() => router.push('/register')}>
            Register Identity
          </Button>
        </div>
        {connectionError && (
          <p role="alert" className="mt-4 text-red-600">{connectionError}</p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-red-600">{error}</p>
        )}
      </section>
      <section className="value-grid" aria-label="Key values">
        <Card><CardHeader><CardTitle>Verifiable Storage</CardTitle><CardDescription>Evidence hashed and tracked on‑chain to ensure integrity.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Transparent Logistics</CardTitle><CardDescription>Lifecycle events captured with timestamps and transaction hashes.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Insurance & Claims</CardTitle><CardDescription>Designed for reliable coverage and dispute transparency.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Indexer‑Backed Proofs</CardTitle><CardDescription>Efficient ingestion with backoff and retry for resilience.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Low‑Friction Onboarding</CardTitle><CardDescription>Connect wallet, register once, and start creating orders.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Analytics Ready</CardTitle><CardDescription>Data streams mapped for dashboards and ops monitoring.</CardDescription></CardHeader></Card>
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
      {null}
      <footer className="site-footer text-center" aria-label="Footer">
        <p>© HaiGo • <a href="/docs">Docs</a> • <a href="/privacy">Privacy</a> • <a href="/contact">Contact</a></p>
      </footer>
      {/* aria-live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', left: -9999 }}>{announce ?? ''}</div>
    </main>
  );
}
