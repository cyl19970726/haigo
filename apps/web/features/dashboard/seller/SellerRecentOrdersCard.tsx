'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@shared/config';
import type { OrderSummaryDto } from '@shared/dto/orders';
import { formatSubunitsToApt } from '@shared/dto/orders';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Skeleton } from '../../../components/ui/skeleton';
import { fetchOrderSummaries } from '../../../lib/api/orders';
import { useSessionAwareWallet } from '../../../lib/session/useSessionAwareWallet';

const RECENT_LIMIT = 5;

const formatPrice = (pricing?: OrderSummaryDto['pricing']) => {
  if (!pricing) return '—';
  const amount = formatSubunitsToApt(pricing.totalSubunits ?? pricing.amountSubunits ?? 0);
  return `${amount.toFixed(2)} APT`;
};

const formatTime = (value?: string) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
};

const resolveStatusVariant = (status: OrderSummaryDto['status']): 'default' | 'secondary' | 'outline' | 'destructive' => {
  switch (status) {
    case 'WAREHOUSE_OUT':
      return 'secondary';
    case 'WAREHOUSE_IN':
    case 'IN_STORAGE':
      return 'default';
    case 'CREATED':
      return 'outline';
    case 'PENDING':
    default:
      return 'destructive';
  }
};

export const SellerRecentOrdersCard = () => {
  const { activeAddress, walletStatus, hasMismatch, sessionAddress } = useSessionAwareWallet();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderSummaryDto[]>([]);
  const [error, setError] = useState<string | undefined>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadOrders = useCallback(async () => {
    if (!activeAddress) {
      if (mountedRef.current) {
        setOrders([]);
        setError(undefined);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(undefined);
    }

    try {
      const response = await fetchOrderSummaries({ sellerAddress: activeAddress, page: 1, pageSize: RECENT_LIMIT });
      if (!mountedRef.current) return;
      setOrders(response.data ?? []);
    } catch (err) {
      console.warn('[HaiGo] Failed to load seller recent orders', err);
      const message = err instanceof Error ? err.message : '加载订单失败';
      if (!mountedRef.current) return;
      setOrders([]);
      setError(message);
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, [activeAddress]);

  useEffect(() => {
    const canFetch = Boolean(activeAddress) && (walletStatus === 'connected' || Boolean(sessionAddress));
    if (!canFetch) {
      setOrders([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    void loadOrders();
  }, [activeAddress, sessionAddress, walletStatus, loadOrders]);

  const handleRetry = useCallback(() => {
    void loadOrders();
  }, [loadOrders]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <ul className="space-y-3" aria-live="polite">
          {Array.from({ length: RECENT_LIMIT }).map((_, index) => (
            <li key={index} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-8 w-20" />
            </li>
          ))}
        </ul>
      );
    }

    if (!activeAddress) {
      return (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>连接卖家钱包并完成登录后，将在此显示最近订单。</p>
        </div>
      );
    }

    if (hasMismatch) {
      return (
        <Alert variant="destructive">
          <AlertTitle>登录信息已变更</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-sm">
            <span>检测到当前钱包地址与登录会话不一致。请重新登录后查看订单。</span>
            <Button variant="outline" size="sm" onClick={handleRetry} className="self-start">
              重试
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (error) {
      return (
        <Alert variant="destructive">
          <AlertTitle>无法加载订单</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-sm">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={handleRetry} className="self-start">
              重试
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (orders.length === 0) {
      return (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>暂无历史订单记录。</p>
          <p>完成第一笔下单后，最新状态会自动显示在此处。</p>
        </div>
      );
    }

    return (
      <ul className="space-y-3">
        {orders.map((order) => (
          <li key={order.recordUid} className="flex flex-col gap-3 rounded-md border border-border/60 p-3 transition-colors hover:border-border">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={resolveStatusVariant(order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
              <span className="text-xs font-medium text-muted-foreground">订单号 #{order.orderId || '草稿'}</span>
              <span className="text-xs text-muted-foreground">{formatTime(order.createdAt)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="space-y-1">
                <div className="font-medium text-foreground">总金额：{formatPrice(order.pricing)}</div>
                <div className="text-xs text-muted-foreground">
                  仓库地址：<span className="font-mono text-[11px]">{order.warehouseAddress}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled title="订单详情页即将上线">
                  查看详情
                </Button>
                <Link
                  href={`/orders/new?warehouse=${encodeURIComponent(order.warehouseAddress)}`}
                  className={`${buttonVariants({ size: 'sm' })} flex items-center gap-1`}
                >
                  复用下单
                </Link>
              </div>
            </div>
            {order.transactionHash && (
              <div className="truncate text-[11px] text-muted-foreground">
                Txn: {order.transactionHash}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }, [activeAddress, error, handleRetry, hasMismatch, loading, orders]);

  return (
    <Card className="h-full">
      <CardHeader className="space-y-1">
        <CardTitle>最近订单</CardTitle>
        <CardDescription>跟踪最新 5 笔仓储订单的状态、金额与提交时间。</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && activeAddress && !error && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载最新订单…
          </div>
        )}
        {content}
      </CardContent>
      <CardFooter className="flex justify-end pt-0">
        <Button variant="ghost" size="sm" disabled title="完整订单列表即将上线">
          查看全部订单
        </Button>
      </CardFooter>
    </Card>
  );
};
