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
import { useSessionProfile } from '../../../lib/session/profile-context';
import Link from 'next/link';

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
  const { sessionProfile } = useSessionProfile();
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

  if (!sessionProfile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 px-6 py-12">
        <div className="max-w-lg space-y-4 rounded-2xl border border-border/70 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-foreground">需要登录仓库账户</h1>
          <p className="text-sm text-muted-foreground">
            尚未检测到有效的仓库登录会话。请返回首页连接钱包并完成登录，然后再次访问此页面。
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/" className={buttonVariants({ variant: 'default' })}>
              返回首页
            </Link>
            <button
              type="button"
              className={buttonVariants({ variant: 'outline' })}
              onClick={() => window.location.reload()}
            >
              重新检查
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (sessionProfile.role !== 'warehouse') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 px-6 py-12">
        <div className="max-w-lg space-y-4 rounded-2xl border border-border/70 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-foreground">当前账户无仓库权限</h1>
          <p className="text-sm text-muted-foreground">
            检测到的登录身份为 {sessionProfile.role === 'seller' ? '商家' : '其他角色'}，无法访问仓库仪表盘。
            如需查看仓库数据，请切换至仓库账户或重新注册。
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/dashboard/seller" className={buttonVariants({ variant: 'default' })}>
              前往商家仪表盘
            </Link>
            <Link href="/register" className={buttonVariants({ variant: 'outline' })}>
              切换/注册账户
            </Link>
          </div>
        </div>
      </main>
    );
  }

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
