'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@shared/config';
import type { OrderSummaryDto } from '@shared/dto/orders';
import { formatSubunitsToApt } from '@shared/dto/orders';
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from '../../../components/ui/pagination';
import { Skeleton } from '../../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { fetchOrderSummaries, type OrderSummariesMeta } from '../../../lib/api/orders';
import { useSessionAwareWallet } from '../../../lib/session/useSessionAwareWallet';

type StatusFilter = 'ALL' | OrderSummaryDto['status'];

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: ORDER_STATUS_LABELS.PENDING ?? 'Draft' },
  { value: 'CREATED', label: ORDER_STATUS_LABELS.CREATED ?? 'Awaiting inbound' },
  { value: 'WAREHOUSE_IN', label: ORDER_STATUS_LABELS.WAREHOUSE_IN ?? 'Checked in' },
  { value: 'IN_STORAGE', label: ORDER_STATUS_LABELS.IN_STORAGE ?? 'In storage' },
  { value: 'WAREHOUSE_OUT', label: ORDER_STATUS_LABELS.WAREHOUSE_OUT ?? 'Outbound in progress' }
];

const PAGE_SIZE = 10;

const formatPrice = (pricing?: OrderSummaryDto['pricing']) => {
  if (!pricing) return '—';
  const amount = formatSubunitsToApt(pricing.totalSubunits ?? pricing.amountSubunits ?? 0);
  return `${amount.toFixed(2)} APT`;
};

const formatDate = (value?: string) => {
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

interface WarehouseOrdersState {
  loading: boolean;
  error?: string;
  data: OrderSummaryDto[];
  meta: OrderSummariesMeta;
}

const initialState: WarehouseOrdersState = {
  loading: true,
  data: [],
  meta: { page: 1, pageSize: PAGE_SIZE, total: 0, generatedAt: undefined, filters: {} }
};

export const WarehouseOrdersView = () => {
  const { activeAddress, sessionAddress, walletAddress, walletStatus, hasMismatch } = useSessionAwareWallet();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [state, setState] = useState<WarehouseOrdersState>(initialState);

  const fetchData = useCallback(
    async (options: { address?: string; page?: number; status?: StatusFilter }) => {
      if (!options.address) {
        setState((prev) => ({ ...prev, loading: false, data: [], error: undefined }));
        return;
      }
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        const response = await fetchOrderSummaries({
          warehouseAddress: options.address,
          status: options.status && options.status !== 'ALL' ? options.status : undefined,
          page: options.page ?? 1,
          pageSize: PAGE_SIZE
        });
        setState({
          loading: false,
          data: response.data,
          meta: response.meta
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load orders';
        console.error('[HaiGo] failed to load warehouse orders', error);
        setState((prev) => ({ ...prev, loading: false, error: message, data: [] }));
      }
    },
    []
  );

  useEffect(() => {
    const canQuery = Boolean(activeAddress) && (walletStatus === 'connected' || Boolean(sessionAddress));
    if (!canQuery) {
      setState(initialState);
      return;
    }
    void fetchData({ address: activeAddress ?? undefined, status: statusFilter, page: 1 });
  }, [activeAddress, sessionAddress, walletStatus, statusFilter, fetchData]);

  const onPageChange = useCallback(
    (direction: 'prev' | 'next') => {
      if (!activeAddress) return;
      const currentPage = state.meta.page ?? 1;
      const totalPages = Math.max(1, Math.ceil((state.meta.total ?? 0) / PAGE_SIZE));
      const nextPage = direction === 'prev' ? Math.max(1, currentPage - 1) : Math.min(totalPages, currentPage + 1);
      if (nextPage === currentPage) return;
      void fetchData({ address: activeAddress, status: statusFilter, page: nextPage });
    },
    [activeAddress, fetchData, state.meta.page, state.meta.total, statusFilter]
  );

  const onManualRefresh = useCallback(() => {
    if (!activeAddress) return;
    void fetchData({ address: activeAddress, status: statusFilter, page: state.meta.page ?? 1 });
  }, [activeAddress, fetchData, state.meta.page, statusFilter]);

  const dataContent = useMemo(() => {
    if (state.loading) {
      return (
        <div className="space-y-3" aria-live="polite">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      );
    }

    if (!activeAddress) {
      return (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          连接仓库钱包并完成登录后，可在此查看订单列表。
        </div>
      );
    }

    if (hasMismatch) {
      return (
        <Alert variant="destructive">
          <AlertTitle>钱包地址已更新</AlertTitle>
          <AlertDescription className="text-sm">
            检测到登录会话地址与当前钱包不一致，系统已自动退出旧会话。请重新登录后再试。
          </AlertDescription>
        </Alert>
      );
    }

    if (state.error) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Unable to load orders</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      );
    }

    if (!state.data.length) {
      return (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No orders match the current filters.
        </div>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Order ID</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-32">Total Amount</TableHead>
            <TableHead className="w-48">Created At</TableHead>
            <TableHead className="w-56">On-chain Hash</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.data.map((order) => (
            <TableRow key={order.recordUid}>
              <TableCell className="font-medium">#{order.orderId || 'Draft'}</TableCell>
              <TableCell>
                <Badge variant={resolveStatusVariant(order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
              </TableCell>
              <TableCell>{formatPrice(order.pricing)}</TableCell>
              <TableCell>{formatDate(order.createdAt)}</TableCell>
              <TableCell className="truncate text-xs text-muted-foreground">{order.transactionHash ?? '—'}</TableCell>
              <TableCell className="text-right text-sm">
                <Link
                  href={`/(warehouse)/orders/${encodeURIComponent(order.recordUid)}/check-in`}
                  className="text-primary hover:underline"
                >
                  View
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }, [activeAddress, hasMismatch, state]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((state.meta.total ?? 0) / PAGE_SIZE)),
    [state.meta.total]
  );

  return (
    <section className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle>Warehouse Inbox</CardTitle>
            <CardDescription>Filter by status to review the latest inbound tasks for the warehouse.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onManualRefresh}
            disabled={state.loading || (!sessionAddress && walletStatus !== 'connected')}
          >
            <RefreshCcw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {walletStatus !== 'connected' && !sessionAddress ? (
            <Alert variant="info">
              <AlertTitle>Warehouse wallet not connected</AlertTitle>
              <AlertDescription>Connect to view orders associated with this warehouse.</AlertDescription>
            </Alert>
          ) : (
            <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <TabsList className="mb-4 flex-wrap justify-start">
                {STATUS_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="capitalize">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {STATUS_TABS.map((tab) => (
                <TabsContent key={tab.value} value={tab.value} className="space-y-4">
                  {dataContent}
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Total {state.meta.total ?? 0} · Page {state.meta.page ?? 1} of {totalPages}
                    </span>
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => {
                              event.preventDefault();
                              onPageChange('prev');
                            }}
                            className="cursor-pointer"
                          />
                        </PaginationItem>
                        <PaginationItem>
                          <PaginationNext
                            onClick={(event) => {
                              event.preventDefault();
                              onPageChange('next');
                            }}
                            className="cursor-pointer"
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>
    </section>
  );
};
