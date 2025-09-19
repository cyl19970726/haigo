'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@shared/config';
import type { OrderSummaryDto } from '@shared/dto/orders';
import { formatSubunitsToApt } from '@shared/dto/orders';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { fetchOrderSummaries } from '../../../lib/api/orders';
import { useWalletContext } from '../../../lib/wallet/context';

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

export const WarehouseOrdersCard = () => {
  const { accountAddress, status: walletStatus } = useWalletContext();
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
    if (!accountAddress) {
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
      const response = await fetchOrderSummaries({ warehouseAddress: accountAddress, page: 1, pageSize: RECENT_LIMIT });
      if (!mountedRef.current) return;
      setOrders(response.data);
    } catch (err) {
      console.warn('[HaiGo] Failed to load warehouse inbox', err);
      const message = err instanceof Error ? err.message : '加载订单失败';
      if (!mountedRef.current) return;
      setOrders([]);
      setError(message);
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, [accountAddress]);

  useEffect(() => {
    if (walletStatus === 'connected') {
      void loadOrders();
    } else {
      setLoading(false);
      setOrders([]);
      setError(undefined);
    }
  }, [accountAddress, walletStatus, loadOrders]);

  const handleRetry = useCallback(() => {
    void loadOrders();
  }, [loadOrders]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <ul className="space-y-3" aria-live="polite">
          {Array.from({ length: RECENT_LIMIT }).map((_, index) => (
            <li key={index} className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-4 w-24" />
            </li>
          ))}
        </ul>
      );
    }
    if (!accountAddress) {
      return (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>连接仓库钱包即可查看专属订单收件箱。</p>
        </div>
      );
    }
    if (error) {
      return (
        <Alert variant="destructive" role="alert">
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
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>暂无待处理订单。</p>
          <p>当商户选择您的仓库时，这里会显示最新订单。</p>
        </div>
      );
    }

    return (
      <ul className="space-y-3">
        {orders.map((order) => (
          <li key={order.recordUid} className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={resolveStatusVariant(order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
                <span className="text-xs text-muted-foreground">#{order.orderId || '草稿'}</span>
              </div>
              <div className="text-sm font-medium text-foreground">{formatPrice(order.pricing)}</div>
              <div className="text-xs text-muted-foreground">创建时间：{formatTime(order.createdAt)}</div>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <Link
                href={`/(warehouse)/orders/${encodeURIComponent(order.recordUid)}/check-in`}
                className="text-xs font-medium text-primary hover:underline"
              >
                查看详情
              </Link>
              {order.transactionHash && (
                <span className="truncate text-[11px] text-muted-foreground">{order.transactionHash}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }, [accountAddress, error, handleRetry, loading, orders]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>订单收件箱</CardTitle>
        <CardDescription>最新来自商户的入库订单会在此处按时间排序。</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && accountAddress && !error && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载最新订单…
          </div>
        )}
        {content}
      </CardContent>
      <CardFooter className="justify-end">
        <Link href="/(warehouse)/orders" className="text-sm font-medium text-primary hover:underline">
          查看全部订单
        </Link>
      </CardFooter>
    </Card>
  );
};
