'use client';

import { useMemo, useState } from 'react';
import { HelpCircle, LibraryBig } from 'lucide-react';
import { SignOutButton } from '../../../features/auth/SignOutButton';
import { WarehouseOrdersCard } from '../../../features/orders/inbox';
import { WarehouseStakingCard } from '../../../features/dashboard/warehouse/WarehouseStakingCard';
import { WarehouseQuickActionsCard } from '../../../features/dashboard/warehouse/WarehouseQuickActionsCard';
import { WarehouseOpsSnapshotCard } from '../../../features/dashboard/warehouse/WarehouseOpsSnapshotCard';
import { WarehouseStakingActionDialog } from '../../../features/dashboard/warehouse/WarehouseStakingActionDialog';
import { useWalletContext } from '../../../lib/wallet/context';
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

const supportLinks = [
  {
    label: '帮助',
    href: 'mailto:support@haigo.xyz',
    icon: HelpCircle
  },
  {
    label: '文档',
    href: 'https://docs.haigo.xyz',
    icon: LibraryBig
  }
];

export default function WarehouseDashboardPage() {
  const { status: walletStatus, networkStatus } = useWalletContext();
  const walletConnected = walletStatus === 'connected';

  const [activeAction, setActiveAction] = useState<null | 'stake' | 'fee'>(null);
  const [stakingRefreshToken, setStakingRefreshToken] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<
    | null
    | {
        type: 'success' | 'error';
        message: string;
        hash?: string;
      }
  >(null);

  const explorerNetwork = useMemo(() => {
    if (!networkStatus) return 'testnet';
    return networkStatus.actual?.toLowerCase() ?? networkStatus.expected.toLowerCase();
  }, [networkStatus]);

  const explorerUrl = (hash?: string) =>
    hash ? `https://explorer.aptoslabs.com/txn/${hash}?network=${explorerNetwork}` : undefined;

  const handleAction = (action: 'stake' | 'fee') => {
    if (!walletConnected) {
      setActionFeedback({ type: 'error', message: '请先连接仓库钱包后再执行此操作。' });
      return;
    }
    setActionFeedback(null);
    setActiveAction(action);
  };

  const handleDialogSuccess = (hash?: string) => {
    setActiveAction(null);
    setStakingRefreshToken((prev) => prev + 1);
    setActionFeedback({
      type: 'success',
      message: '交易已提交，链上确认后最新质押与费率信息将自动刷新。',
      hash
    });
  };

  const handleDialogClose = () => {
    setActiveAction(null);
  };

  return (
    <main className="min-h-screen bg-muted/40">
      <div
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8"
        aria-labelledby="warehouse-dashboard-heading"
      >
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">HaiGo Warehouse</p>
            <h1
              id="warehouse-dashboard-heading"
              className="text-3xl font-semibold tracking-tight text-foreground"
            >
              Warehouse dashboard
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              监控最新的商户订单、质押健康度以及仓储费率，确保运营动作更高效。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {supportLinks.map(({ label, href, icon: Icon }) => {
              const isExternal = href.startsWith('http') || href.startsWith('mailto:');
              const className = cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'flex items-center gap-1 text-sm'
              );
              if (isExternal) {
                return (
                  <a
                    key={label}
                    href={href}
                    aria-label={label}
                    target={href.startsWith('http') ? '_blank' : undefined}
                    rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    className={className}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </a>
                );
              }

              return (
                <a key={label} href={href} aria-label={label} className={className}>
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </a>
              );
            })}
            <SignOutButton />
          </div>
        </header>

        {walletStatus !== 'connected' && (
          <Alert role="status" variant="default">
            <AlertTitle>钱包未连接</AlertTitle>
            <AlertDescription className="text-sm text-muted-foreground">
              连接仓库钱包后可查看最新订单、质押与运营信息。
            </AlertDescription>
          </Alert>
        )}

        {actionFeedback && (
          <Alert variant={actionFeedback.type === 'error' ? 'destructive' : 'default'}>
            <AlertTitle>{actionFeedback.type === 'error' ? '操作未完成' : '操作已提交'}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2 text-sm">
              <span>{actionFeedback.message}</span>
              {actionFeedback.hash && (
                <a
                  href={explorerUrl(actionFeedback.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  查看链上交易
                </a>
              )}
              <button
                type="button"
                className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => setActionFeedback(null)}
              >
                关闭
              </button>
            </AlertDescription>
          </Alert>
        )}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <WarehouseStakingCard refreshToken={stakingRefreshToken} onAction={handleAction} />
          <WarehouseQuickActionsCard onAction={handleAction} walletConnected={walletConnected} />
        </section>

        <WarehouseOrdersCard />

        <WarehouseOpsSnapshotCard />
      </div>

      <WarehouseStakingActionDialog
        mode={activeAction ?? 'stake'}
        open={activeAction !== null}
        onClose={handleDialogClose}
        onSuccess={handleDialogSuccess}
      />
    </main>
  );
}
