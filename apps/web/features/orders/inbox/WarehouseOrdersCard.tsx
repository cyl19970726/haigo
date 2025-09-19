'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@shared/config';
import type { OrderSummaryDto } from '@shared/dto/orders';
import { formatSubunitsToApt } from '@shared/dto/orders';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
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
    return new Intl.DateTimeFormat('en-US', {
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!accountAddress) {
        setOrders([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const response = await fetchOrderSummaries({ warehouseAddress: accountAddress, page: 1, pageSize: RECENT_LIMIT });
        if (!cancelled) {
          setOrders(response.data);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[HaiGo] Failed to load warehouse inbox', error);
          setOrders([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (walletStatus === 'connected') {
      void load();
    } else {
      setLoading(false);
      setOrders([]);
    }

    return () => {
      cancelled = true;
    };
  }, [accountAddress, walletStatus]);

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
          <p>Connect the warehouse wallet to unlock the dedicated inbox.</p>
        </div>
      );
    }
    if (orders.length === 0) {
      return (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>No pending orders right now.</p>
          <p>New orders appear here as soon as merchants choose your warehouse.</p>
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
                <span className="text-xs text-muted-foreground">#{order.orderId || 'Draft'}</span>
              </div>
              <div className="text-sm font-medium text-foreground">{formatPrice(order.pricing)}</div>
              <div className="text-xs text-muted-foreground">Created at: {formatTime(order.createdAt)}</div>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <Link
                href={`/(warehouse)/orders/${encodeURIComponent(order.recordUid)}/check-in`}
                className="text-xs font-medium text-primary hover:underline"
              >
                View details
              </Link>
              {order.transactionHash && (
                <span className="truncate text-[11px] text-muted-foreground">{order.transactionHash}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }, [accountAddress, loading, orders]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Warehouse Inbox</CardTitle>
        <CardDescription>The latest inbound orders from merchants are listed chronologically here.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && accountAddress && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the latest orders…
          </div>
        )}
        {content}
      </CardContent>
      <CardFooter className="justify-end">
        <Link href="/(warehouse)/orders" className="text-sm font-medium text-primary hover:underline">
          View all orders
        </Link>
      </CardFooter>
    </Card>
  );
};
