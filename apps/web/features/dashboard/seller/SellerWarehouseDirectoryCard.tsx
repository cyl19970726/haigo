'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';
import { APTOS_COIN_TYPE, ORDER_DEFAULTS, ORDER_MEDIA_STAGES, ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME } from '@shared/config';
import { type WarehouseSummary, calculatePricing, formatSubunitsToApt } from '@shared/dto/orders';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from '../../../components/ui/pagination';
import { useWarehouseDirectory, type DirectoryFiltersState } from '../../directory/useWarehouseDirectory';
import { cn } from '../../../lib/utils';
import { useWalletContext } from '../../../lib/wallet/context';
import { useOrderDraft } from '../../orders/useOrderDraft';
import { deriveInboundLogistics } from '../../orders/utils';
import { attachDraftTransaction, fetchOrderSummaries } from '../../../lib/api/orders';
import { hexToBytes } from '../../../lib/crypto/hex';
import { Copy, Loader2, RefreshCw, Search, Wallet } from 'lucide-react';

const SORT_OPTIONS: Array<{ value: DirectoryFiltersState['sort']; label: string }> = [
  { value: 'score_desc', label: '评分最高' },
  { value: 'fee_asc', label: '费率最低' },
  { value: 'capacity_desc', label: '承载能力' },
  { value: 'recent', label: '最近更新' }
];

const AVAILABILITY_LABELS: Record<WarehouseSummary['availability'], string> = {
  available: '可用',
  limited: '容量有限',
  maintenance: '维护中'
};

const AVAILABILITY_CLASSES: Record<WarehouseSummary['availability'], string> = {
  available: 'bg-emerald-100 text-emerald-700',
  limited: 'bg-amber-100 text-amber-700',
  maintenance: 'bg-slate-200 text-slate-600'
};

const MEDIA_HASH_REGEX = /^[0-9a-f]{64}$/;

const MEDIA_STAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: ORDER_MEDIA_STAGES.INBOUND, label: '入库凭证' },
  { value: ORDER_MEDIA_STAGES.STORAGE, label: '在仓凭证' },
  { value: ORDER_MEDIA_STAGES.OUTBOUND, label: '出库凭证' }
];

type InlineOrderStage = 'idle' | 'drafting' | 'signing' | 'confirming' | 'success' | 'error';

interface InlineOrderState {
  stage: InlineOrderStage;
  message?: string;
  hash?: string;
}

interface OrderFormState {
  amount: string;
  carrier: string;
  trackingNumber: string;
  notes: string;
  mediaHash: string;
  mediaCategory: string;
}

const INITIAL_ORDER_FORM: OrderFormState = {
  amount: '1',
  carrier: '',
  trackingNumber: '',
  notes: '',
  mediaHash: '',
  mediaCategory: ORDER_MEDIA_STAGES.INBOUND
};

const formatFee = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const percent = value / 100;
  return `${value.toFixed(0)} bps (${percent.toFixed(percent >= 1 ? 1 : 2)}%)`;
};

const formatAuditTime = (value?: string) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const formatCapacity = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value.toLocaleString()} APT`;
};

const extractTxnHash = (result: unknown): string | undefined => {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const candidate =
      (result as any).hash ??
      (result as any).transactionHash ??
      (result as any).txnHash ??
      (result as any).txHash ??
      (result as any).result?.hash;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return undefined;
};

async function pollTransaction(aptos: ReturnType<typeof useWalletContext>['aptos'], hash: string) {
  const maxAttempts = 8;
  let delay = 1500;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const txn = await aptos.transaction.getTransactionByHash({ transactionHash: hash });
      if ((txn as any)?.type === 'user_transaction') {
        if ((txn as any)?.success === false) {
          throw new Error((txn as any)?.vm_status ?? '交易在链上执行失败');
        }
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (!message.includes('not found')) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 8000);
  }
  throw new Error('交易确认超时，请稍后在区块浏览器中检查状态。');
}

export function SellerWarehouseDirectoryCard() {
  const {
    items,
    loading,
    error,
    filters,
    updateFilters,
    resetFilters,
    page,
    pageSize,
    total,
    setPage,
    setPageSize,
    cacheHit,
    generatedAt,
    refetch
  } = useWarehouseDirectory({ available: true, sort: 'score_desc' });
  const [searchValue, setSearchValue] = useState(filters.q ?? '');
  const [areaValue, setAreaValue] = useState(filters.area ?? '');
  const [detailWarehouse, setDetailWarehouse] = useState<WarehouseSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [orderWarehouse, setOrderWarehouse] = useState<WarehouseSummary | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

  useEffect(() => {
    setSearchValue(filters.q ?? '');
  }, [filters.q]);

  useEffect(() => {
    const handler = window.setTimeout(() => {
      const normalized = searchValue.trim();
      if (normalized === (filters.q ?? '')) return;
      updateFilters({ q: normalized || undefined });
    }, 300);
    return () => window.clearTimeout(handler);
  }, [searchValue, updateFilters, filters.q]);

  useEffect(() => {
    setAreaValue(filters.area ?? '');
  }, [filters.area]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showEmptyState = !loading && !error && items.length === 0;

  const handleReset = useCallback(() => {
    setSearchValue('');
    setAreaValue('');
    resetFilters();
  }, [resetFilters]);

  const handleDetail = useCallback((warehouse: WarehouseSummary) => {
    setDetailWarehouse(warehouse);
    setDetailOpen(true);
  }, []);

  const handleOrder = useCallback((warehouse: WarehouseSummary) => {
    setOrderWarehouse(warehouse);
    setOrderOpen(true);
  }, []);

  const handleOrderCompleted = useCallback(() => {
    setOrderOpen(false);
    setOrderWarehouse(null);
  }, []);

  return (
    <>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>合作仓库目录</CardTitle>
          <CardDescription>筛选质押信誉、费用与覆盖区域，直接在此页面发起下单。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex w-full flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Input
                  value={searchValue}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchValue(event.target.value)}
                  placeholder="搜索仓库名称或地址"
                  className="pl-9"
                  aria-label="搜索仓库"
                />
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">服务区域</label>
                <Input
                  value={areaValue}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const next = event.target.value;
                    setAreaValue(next);
                    updateFilters({ area: next.trim() || undefined });
                  }}
                  placeholder="例如:华东"
                  className="w-28"
                  aria-label="服务区域"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">排序</label>
                <select
                  value={filters.sort}
                  onChange={(event) => updateFilters({ sort: event.target.value as DirectoryFiltersState['sort'] })}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={(filters.available ?? true) !== false}
                  onChange={(event) => updateFilters({ available: event.target.checked ? true : undefined })}
                  className="h-4 w-4 rounded border border-input text-primary focus:ring-2 focus:ring-primary"
                />
                仅显示可用
              </label>
              <Button variant="outline" size="sm" onClick={handleReset} className="ml-auto" type="button">
                重置筛选
              </Button>
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>无法加载仓库列表</AlertTitle>
              <AlertDescription className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span>{error}</span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: Math.min(pageSize, 6) }).map((_, index) => (
                <div key={index} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          ) : null}

          {showEmptyState ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border/80 bg-muted/30 p-8 text-sm text-muted-foreground">
              <p>暂未匹配到符合条件的仓库。</p>
              <p className="text-xs">尝试放宽搜索条件或取消“仅显示可用”筛选。</p>
            </div>
          ) : null}

          {!loading && !showEmptyState ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((warehouse) => (
                <article
                  key={warehouse.id}
                  className="flex h-full flex-col gap-4 rounded-xl border border-border bg-background p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{warehouse.name}</h3>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{warehouse.address}</p>
                    </div>
                    <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', AVAILABILITY_CLASSES[warehouse.availability])}>
                      {AVAILABILITY_LABELS[warehouse.availability]}
                    </span>
                  </header>

                  <dl className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div>
                      <dt className="font-medium text-foreground/70">质押评分</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{warehouse.stakingScore.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground/70">信用额度</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{formatCapacity(warehouse.creditCapacity)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground/70">存储费率</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{formatFee(warehouse.feePerUnit)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground/70">最近审计</dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">{formatAuditTime(warehouse.lastAuditAt)}</dd>
                    </div>
                  </dl>

                  {warehouse.serviceAreas?.length ? (
                    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {warehouse.serviceAreas.map((area) => (
                        <span key={area} className="rounded-full bg-muted px-2 py-1">
                          {area}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {warehouse.mediaSamples?.length ? (
                    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {warehouse.mediaSamples.map((sample) => (
                        <span key={sample} className="rounded-full bg-muted px-2 py-1">
                          {sample}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <footer className="mt-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" type="button" onClick={() => handleDetail(warehouse)}>
                      查看详情
                    </Button>
                    <Button size="sm" type="button" onClick={() => handleOrder(warehouse)}>
                      立即下单
                    </Button>
                  </footer>
                </article>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border/80 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                共 <strong>{total}</strong> 个仓库
              </span>
              {generatedAt ? <span>更新于 {formatAuditTime(generatedAt)}</span> : null}
              {cacheHit ? <Badge variant="secondary">缓存命中</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <span>每页</span>
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {[6, 9, 12, 18].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <Pagination className="sm:justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      role="button"
                      aria-disabled={page <= 1}
                      className={cn(page <= 1 && 'pointer-events-none opacity-50')}
                      onClick={() => {
                        if (page > 1) {
                          setPage(page - 1);
                        }
                      }}
                      href="#"
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-3 text-sm">
                      第 {page} / {Math.max(totalPages, 1)} 页
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      role="button"
                      aria-disabled={page >= totalPages}
                      className={cn(page >= totalPages && 'pointer-events-none opacity-50')}
                      onClick={() => {
                        if (page < totalPages) {
                          setPage(page + 1);
                        }
                      }}
                      href="#"
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        </CardContent>
      </Card>

      <WarehouseDetailsDialog
        warehouse={detailWarehouse}
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDetailOpen(false);
            setDetailWarehouse(null);
          } else {
            setDetailOpen(true);
          }
        }}
        onOrder={(warehouseItem) => {
          setDetailOpen(false);
          setDetailWarehouse(null);
          handleOrder(warehouseItem);
        }}
      />

      <WarehouseOrderDialog
        open={orderOpen}
        warehouse={orderWarehouse}
        onOpenChange={(open) => {
          if (!open) {
            setOrderOpen(false);
            setOrderWarehouse(null);
          } else {
            setOrderOpen(true);
          }
        }}
        onCompleted={handleOrderCompleted}
      />
    </>
  );
}

interface WarehouseDetailsDialogProps {
  warehouse: WarehouseSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrder: (warehouse: WarehouseSummary) => void;
}

function WarehouseDetailsDialog({ warehouse, open, onOpenChange, onOrder }: WarehouseDetailsDialogProps) {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!open) {
      setCopyState('idle');
    }
  }, [open]);

  if (!warehouse) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(warehouse.address);
      setCopyState('success');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch (error) {
      console.warn('[HaiGo] failed to copy warehouse address', error);
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 3000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{warehouse.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-[11px]">{warehouse.address}</span>
            <Badge variant="secondary">{AVAILABILITY_LABELS[warehouse.availability]}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm text-muted-foreground">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <DetailItem label="质押评分" value={warehouse.stakingScore.toLocaleString()} />
            <DetailItem label="信用额度" value={formatCapacity(warehouse.creditCapacity)} />
            <DetailItem label="存储费率" value={formatFee(warehouse.feePerUnit)} />
            <DetailItem label="最近审计" value={formatAuditTime(warehouse.lastAuditAt)} />
            <DetailItem label="保险保障" value={warehouse.insuranceCoverage ?? '—'} />
            <DetailItem
              label="服务区域"
              value={warehouse.serviceAreas?.length ? warehouse.serviceAreas.join('，') : '—'}
            />
          </div>

          {warehouse.mediaSamples?.length ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">仓库标签：</span>
              {warehouse.mediaSamples.map((sample) => (
                <Badge key={sample} variant="secondary">
                  {sample}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className={cn('text-xs', copyState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {copyState === 'success' ? '地址已复制' : copyState === 'error' ? '复制失败，请手动复制。' : '复制仓库地址以便核对链上数据。'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              复制地址
            </Button>
            <Button type="button" variant="secondary" asChild>
              <Link href={`/orders/new?warehouse=${encodeURIComponent(warehouse.address)}`}>
                前往创建订单
              </Link>
            </Button>
            <Button type="button" onClick={() => onOrder(warehouse)}>
              立即下单
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground/60">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

interface WarehouseOrderDialogProps {
  warehouse: WarehouseSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: (hash: string) => void;
}

function WarehouseOrderDialog({ warehouse, open, onOpenChange, onCompleted }: WarehouseOrderDialogProps) {
  const router = useRouter();
  const {
    status: walletStatus,
    accountAddress,
    availableWallets,
    connect,
    signAndSubmitTransaction,
    aptos
  } = useWalletContext();
  const { recordUid, createDraft, loading: draftLoading, error: draftError } = useOrderDraft();
  const [form, setForm] = useState<OrderFormState>(INITIAL_ORDER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<InlineOrderState>({ stage: 'idle' });

  useEffect(() => {
    if (!open) {
      setForm(INITIAL_ORDER_FORM);
      setErrors({});
      setState({ stage: 'idle' });
    }
  }, [open]);

  const pricing = useMemo(() => {
    const amount = Number.parseFloat(form.amount);
    const safeAmount = Number.isFinite(amount) ? Math.max(amount, 0) : 0;
    return calculatePricing({
      amountApt: safeAmount,
      insuranceRateBps: ORDER_DEFAULTS.insuranceRateBps,
      platformFeeBps: ORDER_DEFAULTS.platformFeeBps
    });
  }, [form.amount]);

  const handleChange = (patch: Partial<OrderFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    const amount = Number.parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      next.amount = '请输入大于 0 的订单金额（APT）。';
    } else if (amount > ORDER_DEFAULTS.amountMaxApt) {
      next.amount = `金额上限为 ${ORDER_DEFAULTS.amountMaxApt} APT。`;
    }
    if (form.mediaHash) {
      const normalized = form.mediaHash.trim().toLowerCase();
      if (!MEDIA_HASH_REGEX.test(normalized)) {
        next.mediaHash = '媒体哈希需为 64 位小写十六进制字符串。';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleConnectWallet = async () => {
    const first = availableWallets[0];
    if (!first) {
      setState({ stage: 'error', message: '未检测到可用钱包，请安装兼容 Aptos 的钱包。' });
      return;
    }
    try {
      await connect(first.name);
      setState({ stage: 'idle' });
    } catch (error) {
      setState({
        stage: 'error',
        message: error instanceof Error ? error.message : '连接钱包失败，请重试。'
      });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!warehouse) return;
    if (!signAndSubmitTransaction) {
      setState({ stage: 'error', message: '当前环境不支持直接提交交易，请前往完整下单页面。' });
      return;
    }
    if (!accountAddress) {
      setState({ stage: 'error', message: '请先连接钱包后再提交订单。' });
      return;
    }
    if (!validate()) {
      return;
    }

    const inboundLogistics = deriveInboundLogistics({
      carrier: form.carrier,
      trackingNumber: form.trackingNumber,
      notes: form.notes
    });
    const normalizedMediaHash = form.mediaHash.trim().toLowerCase();
    const payload: InputGenerateTransactionPayloadData = {
      function: `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::create_order`,
      typeArguments: [APTOS_COIN_TYPE],
      functionArguments: [
        warehouse.address,
        inboundLogistics ?? null,
        pricing.amountSubunits.toString(),
        pricing.insuranceFeeSubunits.toString(),
        pricing.platformFeeSubunits.toString(),
        normalizedMediaHash ? form.mediaCategory : null,
        normalizedMediaHash ? Array.from(hexToBytes(normalizedMediaHash)) : null
      ]
    };

    try {
      setState({ stage: 'drafting' });
      const draftUid = await createDraft({
        sellerAddress: accountAddress,
        warehouseAddress: warehouse.address,
        inboundLogistics: inboundLogistics ?? null,
        pricing,
        initialMedia: normalizedMediaHash ? { category: form.mediaCategory, hashValue: normalizedMediaHash } : null
      });

      setState({ stage: 'signing' });
      const result = await signAndSubmitTransaction({
        sender: accountAddress,
        data: payload
      });
      const txnHash = extractTxnHash(result);
      if (!txnHash) {
        throw new Error('钱包未返回交易哈希，请检查签名结果。');
      }

      setState({ stage: 'confirming', hash: txnHash });
      if (draftUid) {
        void attachDraftTransaction(draftUid, txnHash).catch((err) => {
          console.warn('[HaiGo] failed to attach draft transaction', err);
        });
      }

      await pollTransaction(aptos, txnHash);
      setState({ stage: 'success', hash: txnHash });

      try {
        await fetchOrderSummaries({ sellerAddress: accountAddress });
      } catch (err) {
        console.warn('[HaiGo] refresh orders failed', err);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('haigo:orders:refresh'));
      }
      router.refresh();
      onCompleted(txnHash);
    } catch (error) {
      console.error('[HaiGo] inline order submission failed', error);
      setState({
        stage: 'error',
        message: error instanceof Error ? error.message : '提交订单失败，请稍后重试。'
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{warehouse ? `下单：${warehouse.name}` : '请选择仓库'}</DialogTitle>
          <DialogDescription>
            填写订单要素并通过连接的钱包直接调用链上合约
            {warehouse ? `（${warehouse.address}）` : ''}。
          </DialogDescription>
        </DialogHeader>

        {!warehouse ? (
          <div className="rounded-lg bg-muted/30 p-6 text-sm text-muted-foreground">请选择一个仓库后再尝试下单。</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="grid gap-4 rounded-lg border border-border/70 bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="text-xs font-medium text-foreground/60">仓库地址</div>
                <div className="font-mono text-[11px]">{warehouse.address}</div>
                <div className="text-xs font-medium text-foreground/60">存储费率</div>
                <div className="font-semibold text-foreground">{formatFee(warehouse.feePerUnit)}</div>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="text-xs font-medium text-foreground/60">质押评分</div>
                <div className="font-semibold text-foreground">{warehouse.stakingScore.toLocaleString()}</div>
                <div className="text-xs font-medium text-foreground/60">信用额度</div>
                <div className="font-semibold text-foreground">{formatCapacity(warehouse.creditCapacity)}</div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground/70" htmlFor="order-amount">
                    订单金额（APT）
                  </label>
                  <Input
                    id="order-amount"
                    type="number"
                    step="0.01"
                    min={ORDER_DEFAULTS.amountMinApt}
                    value={form.amount}
                    onChange={(event) => handleChange({ amount: event.target.value })}
                    disabled={state.stage !== 'idle' && state.stage !== 'error'}
                    required
                  />
                  {errors.amount ? <p className="text-xs text-destructive">{errors.amount}</p> : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground/70" htmlFor="order-carrier">
                    物流承运商（可选）
                  </label>
                  <Input
                    id="order-carrier"
                    value={form.carrier}
                    onChange={(event) => handleChange({ carrier: event.target.value })}
                    disabled={state.stage !== 'idle' && state.stage !== 'error'}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground/70" htmlFor="order-tracking">
                    运单号（可选）
                  </label>
                  <Input
                    id="order-tracking"
                    value={form.trackingNumber}
                    onChange={(event) => handleChange({ trackingNumber: event.target.value })}
                    disabled={state.stage !== 'idle' && state.stage !== 'error'}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground/70" htmlFor="order-media-stage">
                    媒资阶段
                  </label>
                  <select
                    id="order-media-stage"
                    value={form.mediaCategory}
                    onChange={(event) => handleChange({ mediaCategory: event.target.value })}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    disabled={state.stage !== 'idle' && state.stage !== 'error'}
                  >
                    {MEDIA_STAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/70" htmlFor="order-media-hash">
                  媒资 Hash（可选）
                </label>
                <Input
                  id="order-media-hash"
                  placeholder="64 位小写十六进制"
                  value={form.mediaHash}
                  onChange={(event) => handleChange({ mediaHash: event.target.value })}
                  disabled={state.stage !== 'idle' && state.stage !== 'error'}
                />
                {errors.mediaHash ? <p className="text-xs text-destructive">{errors.mediaHash}</p> : null}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/70" htmlFor="order-notes">
                  备注（可选）
                </label>
                <textarea
                  id="order-notes"
                  value={form.notes}
                  onChange={(event) => handleChange({ notes: event.target.value })}
                  className="min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={state.stage !== 'idle' && state.stage !== 'error'}
                />
              </div>
            </section>

            <section className="rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-3">
                <span>金额：{formatSubunitsToApt(pricing.amountSubunits).toFixed(2)} APT</span>
                <span>保险费：{formatSubunitsToApt(pricing.insuranceFeeSubunits).toFixed(2)} APT</span>
                <span>平台费：{formatSubunitsToApt(pricing.platformFeeSubunits).toFixed(2)} APT</span>
                <span className="font-medium text-foreground">
                  合计：{formatSubunitsToApt(pricing.totalSubunits).toFixed(2)} APT
                </span>
              </div>
              <p className="mt-2 text-xs">
                保险与平台费率分别来自默认配置 {ORDER_DEFAULTS.insuranceRateBps} bps / {ORDER_DEFAULTS.platformFeeBps} bps。
              </p>
            </section>

            {draftError ? (
              <Alert variant="warning">
                <AlertTitle>草稿创建提示</AlertTitle>
                <AlertDescription>{draftError}</AlertDescription>
              </Alert>
            ) : null}

            {state.stage === 'error' && state.message ? (
              <Alert variant="destructive">
                <AlertTitle>下单失败</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            {state.stage === 'success' && state.hash ? (
              <Alert variant="success">
                <AlertTitle>订单已提交</AlertTitle>
                <AlertDescription>交易哈希：{state.hash}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter className="gap-3">
              {walletStatus !== 'connected' ? (
                <Button type="button" variant="outline" onClick={handleConnectWallet}>
                  <Wallet className="mr-2 h-4 w-4" aria-hidden />
                  连接钱包
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={state.stage === 'drafting' || state.stage === 'signing' || state.stage === 'confirming'}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  !warehouse ||
                  walletStatus !== 'connected' ||
                  state.stage === 'drafting' ||
                  state.stage === 'signing' ||
                  state.stage === 'confirming'
                }
              >
                {state.stage === 'drafting' || draftLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    正在创建草稿…
                  </>
                ) : state.stage === 'signing' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    等待钱包签名…
                  </>
                ) : state.stage === 'confirming' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    等待链上确认…
                  </>
                ) : (
                  '生成草稿并提交交易'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
