'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { StakingIntentDto } from '@shared/dto/staking';
import { buttonVariants } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { useWalletContext } from '../../../lib/wallet/context';
import { useSessionAwareWallet } from '../../../lib/session/useSessionAwareWallet';
import { fetchStakingIntent } from '../../../lib/api/staking';
import { cn } from '../../../lib/utils';

const OCTA_PER_APT = 100_000_000n;

const formatApt = (value: string) => {
  try {
    const bigint = BigInt(value ?? '0');
    const aptValue = Number(bigint) / Number(OCTA_PER_APT);
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(aptValue);
  } catch (error) {
    return '0.00';
  }
};

const computeDelta = (staked: string, required: string) => {
  try {
    const stakedBig = BigInt(staked ?? '0');
    const requiredBig = BigInt(required ?? '0');
    return stakedBig - requiredBig;
  } catch (error) {
    return 0n;
  }
};

type StakingAction = 'stake' | 'fee';

interface WarehouseStakingCardProps {
  refreshToken?: number;
  onAction?: (action: StakingAction) => void;
}

export const WarehouseStakingCard = ({ refreshToken, onAction }: WarehouseStakingCardProps) => {
  const { accountAddress, status: walletStatus } = useWalletContext();
  const { activeAddress, hasMismatch, sessionAddress } = useSessionAwareWallet();
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState<StakingIntentDto | null>(null);
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const loadStaking = useCallback(async () => {
    abortRef.current?.abort();
    setError(undefined);

    if (!activeAddress) {
      setIntent(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const data = await fetchStakingIntent(activeAddress);
      if (!controller.signal.aborted) {
        setIntent(data);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      console.warn('[HaiGo] Failed to load staking intent', err);
      const message = err instanceof Error ? err.message : '无法读取质押数据';
      setIntent(null);
      setError(message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [activeAddress]);

  useEffect(() => {
    const canFetch = Boolean(activeAddress) && (walletStatus === 'connected' || Boolean(sessionAddress));
    if (!canFetch) {
      setIntent(null);
      setError(undefined);
      setLoading(false);
    } else {
      void loadStaking();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [activeAddress, sessionAddress, walletStatus, loadStaking, refreshToken]);

  const stakeDelta = useMemo(() => computeDelta(intent?.stakedAmount ?? '0', intent?.minRequired ?? '0'), [intent]);
  const stakeHealthy = stakeDelta >= 0n;

  const renderMetrics = () => {
    if (loading) {
      return (
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      );
    }

    if (!activeAddress) {
      return (
        <p className="text-sm text-muted-foreground">连接仓库钱包并完成登录后即可查看质押与费用状态。</p>
      );
    }

    if (hasMismatch) {
      return (
        <Alert variant="destructive">
          <AlertTitle>登录会话已更新</AlertTitle>
          <AlertDescription className="text-sm">
            当前钱包地址与会话不一致，系统已退出旧会话。请重新登录后查看质押数据。
          </AlertDescription>
        </Alert>
      );
    }

    if (error) {
      return (
        <Alert variant="destructive">
          <AlertTitle>质押数据加载失败</AlertTitle>
          <AlertDescription className="text-sm">
            {error}
            <button
              type="button"
              className="mt-2 rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-muted"
              onClick={() => loadStaking()}
            >
              重试
            </button>
          </AlertDescription>
        </Alert>
      );
    }

    if (!intent) {
      return <p className="text-sm text-muted-foreground">暂无质押记录。</p>;
    }

    const stakedFormatted = formatApt(intent.stakedAmount);
    const requiredFormatted = formatApt(intent.minRequired);
    const deltaFormatted = formatApt(stakeDelta.toString());

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">当前质押</p>
            <p className="text-2xl font-semibold text-foreground">{stakedFormatted} APT</p>
          </div>
          {stakeHealthy ? (
            <div className="flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              达标
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
              需补仓
            </div>
          )}
        </div>

        <dl className="grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">最低要求</dt>
            <dd className="font-medium text-foreground">{requiredFormatted} APT</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">差值</dt>
            <dd
              className={cn('font-medium', stakeHealthy ? 'text-emerald-600' : 'text-amber-600')}
            >
              {stakeHealthy ? '+' : ''}
              {deltaFormatted} APT
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">仓储费率</dt>
            <dd className="font-medium text-foreground">{intent.feePerUnit} bps</dd>
          </div>
        </dl>
      </div>
    );
  };

  return (
    <Card className="h-full">
      <CardHeader className="space-y-1">
        <CardTitle>质押与费用概览</CardTitle>
        <CardDescription>关注质押是否达标，以及当前生效的仓储费率。</CardDescription>
      </CardHeader>
      <CardContent>{renderMetrics()}</CardContent>
      <CardFooter className="flex flex-wrap items-center justify-end gap-2 pt-0">
        <button
          type="button"
          onClick={() => onAction?.('stake')}
          disabled={walletStatus !== 'connected'}
          className={cn(
            buttonVariants({ variant: 'default', size: 'sm' }),
            'gap-1 font-medium',
            walletStatus !== 'connected' ? 'cursor-not-allowed opacity-60' : ''
          )}
        >
          快速质押
        </button>
        <button
          type="button"
          onClick={() => onAction?.('fee')}
          disabled={walletStatus !== 'connected'}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'gap-1 font-medium',
            walletStatus !== 'connected' ? 'cursor-not-allowed opacity-60' : ''
          )}
        >
          调整费率
        </button>
      </CardFooter>
    </Card>
  );
};
