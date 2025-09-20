'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { StakingIntentDto } from '@shared/dto/staking';

import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '../../../components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { useWalletContext } from '../../../lib/wallet/context';
import { fetchStakingIntent } from '../../../lib/api/staking';
import { useStakingActions } from '../../staking/useStakingActions';

interface WarehouseStakingActionDialogProps {
  mode: 'stake' | 'fee';
  open: boolean;
  onClose: () => void;
  onSuccess?: (hash?: string) => void;
}

const OCTA_PER_APT = 100_000_000;
const EXPLORER_BASE_URL = 'https://explorer.aptoslabs.com/txn/';

const formatApt = (value: string | number) => {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return '0.0000';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
};

export function WarehouseStakingActionDialog({ mode, open, onClose, onSuccess }: WarehouseStakingActionDialogProps) {
  const { accountAddress, status, networkStatus } = useWalletContext();
  const walletConnected = status === 'connected';

  const { stake, setStorageFee, submitting, error: actionError, lastHash } = useStakingActions();

  const [intent, setIntent] = useState<StakingIntentDto | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);

  const [amountInput, setAmountInput] = useState('');
  const [feeInput, setFeeInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);

  const isStakeMode = mode === 'stake';

  const resetForm = useCallback(() => {
    setAmountInput('');
    setFeeInput('');
    setLocalError(null);
    setSubmittedHash(null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    resetForm();

    if (!accountAddress) {
      setIntent(null);
      setIntentError(null);
      return;
    }

    let cancelled = false;

    const loadIntent = async () => {
      try {
        setIntentLoading(true);
        setIntentError(null);
        const data = await fetchStakingIntent(accountAddress);
        if (cancelled) return;
        setIntent(data);
        if (typeof data.feePerUnit !== 'undefined') {
          setFeeInput(String(data.feePerUnit));
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '无法读取当前质押信息';
        setIntentError(message);
        setIntent(null);
      } finally {
        if (!cancelled) {
          setIntentLoading(false);
        }
      }
    };

    void loadIntent();

    return () => {
      cancelled = true;
    };
  }, [open, accountAddress, resetForm]);

  useEffect(() => {
    if (lastHash) {
      setSubmittedHash(lastHash);
    }
  }, [lastHash]);

  const stakingSummary = useMemo(() => {
    if (!intent) return null;
    const stakedOcta = Number(intent.stakedAmount ?? '0');
    const minRequiredOcta = Number(intent.minRequired ?? '0');
    return {
      stakedApt: stakedOcta / OCTA_PER_APT,
      minRequiredApt: minRequiredOcta / OCTA_PER_APT,
      feePerUnit: intent.feePerUnit
    };
  }, [intent]);

  const explorerNetwork = useMemo(() => {
    if (!networkStatus) return 'testnet';
    return networkStatus.actual?.toLowerCase() ?? networkStatus.expected.toLowerCase();
  }, [networkStatus]);

  const explorerUrl = submittedHash ? `${EXPLORER_BASE_URL}${submittedHash}?network=${explorerNetwork}` : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    if (!walletConnected || !accountAddress) {
      setLocalError('请先连接仓库钱包。');
      return;
    }

    try {
      if (isStakeMode) {
        const parsed = Number.parseFloat(amountInput);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setLocalError('请输入大于 0 的质押金额（APT）。');
          return;
        }
        const hash = await stake(parsed);
        onSuccess?.(hash);
      } else {
        const parsed = Number.parseFloat(feeInput);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setLocalError('请输入合法的费率（基点）。');
          return;
        }
        if (parsed > 10_000) {
          setLocalError('费率上限为 10000 bps。');
          return;
        }
        const hash = await setStorageFee(parsed);
        onSuccess?.(hash);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试。';
      setLocalError(message);
    }
  };

  const renderSummary = () => {
    if (intentLoading) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/80 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          正在加载当前质押状态…
        </div>
      );
    }

    if (intentError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>质押状态读取失败</AlertTitle>
          <AlertDescription>{intentError}</AlertDescription>
        </Alert>
      );
    }

    if (!stakingSummary) {
      return null;
    }

    return (
      <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">当前状态</p>
        <div className="mt-2 grid gap-1 text-foreground">
          <span>质押总额：{formatApt(stakingSummary.stakedApt)} APT</span>
          <span>最低要求：{formatApt(stakingSummary.minRequiredApt)} APT</span>
          <span>存储费率：{stakingSummary.feePerUnit ?? 0} bps</span>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl border-none bg-transparent p-0 shadow-none">
        <Card className="border border-border bg-white text-foreground shadow-xl sm:rounded-2xl">
          <CardHeader className="px-6 pt-6 pb-0">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
                  {isStakeMode ? '快速质押' : '调整存储费率'}
                </DialogTitle>
                <DialogDescription>
                  {isStakeMode
                    ? '追加仓库质押额度以维持信用权重和服务资格。'
                    : '更新仓储费率（基点），将影响新订单的成本计算。'}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="关闭">
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </DialogClose>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 px-6 pb-0">
            {!walletConnected && (
              <Alert>
                <AlertTitle>未连接仓库钱包</AlertTitle>
                <AlertDescription>连接后即可提交质押或更新存储费率。</AlertDescription>
              </Alert>
            )}

            {renderSummary()}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {isStakeMode ? (
                <div className="space-y-2">
                  <Label htmlFor="warehouse-stake-amount">质押金额（APT）</Label>
                  <Input
                    id="warehouse-stake-amount"
                    type="number"
                    min="0"
                    step="0.0001"
                    inputMode="decimal"
                    placeholder="例如 50"
                    value={amountInput}
                    onChange={(event) => setAmountInput(event.target.value)}
                    disabled={!walletConnected || submitting}
                    aria-describedby="warehouse-stake-helper"
                  />
                  <p id="warehouse-stake-helper" className="text-xs text-muted-foreground">
                    支持四位小数，将自动转换为链上 octa 单位。
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="warehouse-fee">存储费率（基点）</Label>
                  <Input
                    id="warehouse-fee"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                    inputMode="numeric"
                    placeholder="例如 35"
                    value={feeInput}
                    onChange={(event) => setFeeInput(event.target.value)}
                    disabled={!walletConnected || submitting}
                    aria-describedby="warehouse-fee-helper"
                  />
                  <p id="warehouse-fee-helper" className="text-xs text-muted-foreground">
                    取值范围 0 ~ 10000 bps（0% ~ 100%）。
                  </p>
                </div>
              )}

              {(localError || actionError) && (
                <Alert variant="destructive">
                  <AlertTitle>提交失败</AlertTitle>
                  <AlertDescription>{localError || actionError}</AlertDescription>
                </Alert>
              )}

              {submittedHash && (
                <Alert>
                  <AlertTitle>交易已提交</AlertTitle>
                  <AlertDescription>
                    {explorerUrl ? (
                      <a href={explorerUrl} target="_blank" rel="noreferrer" className="underline">
                        查看链上交易 {submittedHash.slice(0, 10)}…
                      </a>
                    ) : (
                      <span>交易哈希：{submittedHash}</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <CardFooter className="flex justify-end gap-2 px-0 pb-0">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                  取消
                </Button>
                <Button type="submit" disabled={!walletConnected || submitting}>
                  {submitting ? '提交中…' : isStakeMode ? '确认质押' : '保存费率'}
                </Button>
              </CardFooter>
            </form>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

export default WarehouseStakingActionDialog;
