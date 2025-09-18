'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  ORDER_MEDIA_ACCEPTED_MIME,
  ORDER_MEDIA_CATEGORIES,
  ORDER_MEDIA_STAGES,
  ORDER_MEDIA_VERIFICATION_STATUSES,
  ORDER_STATUS_LABELS,
  ORDERS_MODULE_ADDRESS,
  ORDERS_MODULE_NAME
} from '@shared/config';
import type { OrderDetailDto, OrderMediaAsset, OrderMediaVerificationStatus } from '@shared/dto/orders';
import { fetchOrderDetail } from '../../../lib/api/orders';
import {
  clearInboundMediaDraft,
  loadInboundMediaDraft,
  saveInboundMediaDraft,
  type CachedMediaItem
} from '../../../lib/storage/inbound-media-cache';
import { hexToBytes } from '../../../lib/crypto/hex';
import { useWalletContext } from '../../../lib/wallet/context';
import { NetworkGuard } from '../../../lib/wallet/network-guard';
import { useInboundMediaManager } from './useInboundMediaManager';
import { requestMediaReverification } from '../../../lib/api/media';
import { deriveInboundLogistics } from '../utils';

const ACCEPT_ATTR = [
  ...ORDER_MEDIA_ACCEPTED_MIME.IMAGE,
  ...ORDER_MEDIA_ACCEPTED_MIME.VIDEO,
  ...ORDER_MEDIA_ACCEPTED_MIME.DOCUMENT
].join(',');

const EXPLORER_BASE_URL = 'https://explorer.aptoslabs.com/txn/';
const CHECK_IN_FUNCTION = `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::check_in` as `${string}::${string}::${string}`;

const buildExplorerUrl = (hash: string, network: string) => `${EXPLORER_BASE_URL}${hash}?network=${network}`;

const formatBytes = (value: number): string => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : size > 10 ? 1 : 2)} ${units[index]}`;
};

const formatTime = (value?: string) => {
  if (!value) return '';
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

const computeSlaCountdown = (createdAt?: string) => {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const slaMs = 2 * 60 * 60 * 1000; // 2 小时入库 SLA
  const due = created + slaMs;
  const remaining = due - Date.now();
  return {
    due,
    remaining,
    isOverdue: remaining < 0
  };
};

const resolveStatusLabel = (status?: string) => {
  if (!status) return 'Unknown status';
  return ORDER_STATUS_LABELS[status] ?? status;
};

interface LogisticsState {
  carrier: string;
  trackingNumber: string;
  notes: string;
}

type WizardStep = 'logistics' | 'media' | 'review';

type TransactionStage = 'idle' | 'submitting' | 'pending' | 'success' | 'failed';

interface TransactionState {
  stage: TransactionStage;
  hash?: string;
  explorerUrl?: string;
  error?: string;
}

interface OrderCheckInViewProps {
  recordUid: string;
}

interface VerificationBadgeProps {
  status: OrderMediaVerificationStatus;
  attempts: number;
}

const VerificationBadge = ({ status, attempts }: VerificationBadgeProps) => {
  const labelMap: Record<OrderMediaVerificationStatus, { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' }> = {
    [ORDER_MEDIA_VERIFICATION_STATUSES.PENDING]: { label: '待验证', tone: 'neutral' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.VERIFYING]: { label: '验证中', tone: 'warning' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.VERIFIED]: { label: '验证通过', tone: 'success' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.FAILED]: { label: '验证失败', tone: 'danger' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.RECHECKING]: { label: '重新验证中', tone: 'warning' }
  };

  const { label, tone } = labelMap[status] ?? labelMap[ORDER_MEDIA_VERIFICATION_STATUSES.PENDING];

  return (
    <span className={`badge badge-${tone}`} aria-live="polite">
      {label}
      {attempts > 1 ? ` · 第 ${attempts} 次` : ''}
    </span>
  );
};

const MediaVerificationActions = ({
  disabled,
  onVerify
}: {
  disabled: boolean;
  onVerify: () => void;
}) => {
  return (
    <button type="button" className="ghost" onClick={onVerify} disabled={disabled}>
      重新验证
    </button>
  );
};

const WalletGate = ({
  walletStatus,
  onConnect,
  availableWallets
}: {
  walletStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: (walletName: string) => void;
  availableWallets: { name: string; icon: string }[];
}) => {
  if (walletStatus === 'connected') return null;

  return (
    <section className="panel warning" aria-live="assertive">
      <h2>连接仓主钱包以继续</h2>
      <p>提交入库需要仓主钱包签名，请先连接钱包。</p>
      <div className="wallet-options">
        {availableWallets.map((wallet) => (
          <button
            key={wallet.name}
            type="button"
            className="primary"
            onClick={() => void onConnect(wallet.name)}
            disabled={walletStatus === 'connecting'}
          >
            {wallet.name}
          </button>
        ))}
      </div>
    </section>
  );
};

const StepIndicator = ({ activeStep }: { activeStep: WizardStep }) => {
  const steps: { id: WizardStep; label: string; description: string }[] = [
    { id: 'logistics', label: '步骤 1', description: '填写物流信息' },
    { id: 'media', label: '步骤 2', description: '上传入库媒体' },
    { id: 'review', label: '步骤 3', description: '确认并上链' }
  ];

  return (
    <ol className="step-indicator" aria-label="入库操作步骤">
      {steps.map((step) => (
        <li key={step.id} className={step.id === activeStep ? 'active' : ''} aria-current={step.id === activeStep ? 'step' : undefined}>
          <span className="step-label">{step.label}</span>
          <span className="step-description">{step.description}</span>
        </li>
      ))}
    </ol>
  );
};

const deriveMediaCaption = (category: string) => {
  switch (category) {
    case ORDER_MEDIA_CATEGORIES.INBOUND_PHOTO:
      return '入库现场照片';
    case ORDER_MEDIA_CATEGORIES.INBOUND_VIDEO:
      return '入库现场视频';
    case ORDER_MEDIA_CATEGORIES.INBOUND_DOCUMENT:
      return '入库凭证文档';
    default:
      return '入库媒体';
  }
};

const resolveTransactionHash = (result: unknown): string | undefined => {
  if (!result) return undefined;
  if (typeof result === 'string') return result;
  if (typeof (result as any)?.hash === 'string') return (result as any).hash;
  if (typeof (result as any)?.transactionHash === 'string') return (result as any).transactionHash;
  if (typeof (result as any)?.txnHash === 'string') return (result as any).txnHash;
  if (typeof (result as any)?.result?.hash === 'string') return (result as any).result.hash;
  return undefined;
};

export function OrderCheckInView({ recordUid }: OrderCheckInViewProps) {
  const {
    status: walletStatus,
    availableWallets,
    connect,
    accountAddress,
    signAndSubmitTransaction,
    networkStatus,
    aptos
  } = useWalletContext();

  const [orderDetail, setOrderDetail] = useState<OrderDetailDto | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);
  const [orderError, setOrderError] = useState<string>();

  const [logistics, setLogistics] = useState<LogisticsState>({ carrier: '', trackingNumber: '', notes: '' });
  const [logisticsErrors, setLogisticsErrors] = useState<Record<keyof LogisticsState, string>>({
    carrier: '',
    trackingNumber: '',
    notes: ''
  });

  const [activeStep, setActiveStep] = useState<WizardStep>('logistics');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [initialCachedItems, setInitialCachedItems] = useState<CachedMediaItem[]>();
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [transactionState, setTransactionState] = useState<TransactionState>({ stage: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setOrderLoading(true);
    fetchOrderDetail(recordUid)
      .then((detail) => {
        if (cancelled) return;
        setOrderDetail(detail);
        setOrderError(undefined);
        setOrderLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setOrderError(error instanceof Error ? error.message : '无法加载订单详情');
        setOrderLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recordUid]);

  useEffect(() => {
    let cancelled = false;
    loadInboundMediaDraft(recordUid)
      .then((draft) => {
        if (cancelled) return;
        if (draft) {
          setInitialCachedItems(draft.items);
          setLogistics((prev) => ({ ...prev, ...draft.logistics }));
        }
        setDraftLoaded(true);
      })
      .catch((error) => {
        console.warn('[HaiGo] failed to load inbound media draft', error);
        if (!cancelled) {
          setDraftLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordUid]);

  const {
    items: mediaItems,
    addFiles,
    removeItem,
    uploadItem,
    uploadAll,
    markAsset,
    updateVerificationStatus,
    markMatched,
    messages: mediaMessages,
    dismissMessage,
    primaryHashAlgorithm,
    secondaryHashAlgorithm,
    isProcessing,
    toCachePayload
  } = useInboundMediaManager({ recordUid, cachedItems: draftLoaded ? initialCachedItems : undefined });

  const mediaItemsRef = useRef(mediaItems);

  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  useEffect(() => {
    if (!draftLoaded) return;
    const cacheItems = toCachePayload();
    const hasItems = cacheItems.length > 0;
    const hasLogisticsValues = Boolean(logistics.carrier || logistics.trackingNumber || logistics.notes);

    if (!hasItems && !hasLogisticsValues) {
      void clearInboundMediaDraft(recordUid);
      return;
    }

    void saveInboundMediaDraft({
      recordUid,
      items: cacheItems,
      logistics,
      savedAt: Date.now()
    });
  }, [draftLoaded, logistics, recordUid, mediaItems, toCachePayload]);

  useEffect(() => {
    if (!orderDetail?.mediaAssets?.length) return;
    orderDetail.mediaAssets.forEach((asset) => markAsset(asset));
  }, [orderDetail?.mediaAssets, markAsset]);

  const sla = useMemo(() => computeSlaCountdown(orderDetail?.createdAt), [orderDetail?.createdAt]);

  const handleLogisticsChange = useCallback(
    (field: keyof LogisticsState, value: string) => {
      setLogistics((prev) => ({ ...prev, [field]: value }));
      setLogisticsErrors((prev) => ({ ...prev, [field]: '' }));
    },
    []
  );

  const validateLogistics = useCallback(() => {
    const errors: Record<keyof LogisticsState, string> = { carrier: '', trackingNumber: '', notes: '' };
    if (!logistics.carrier.trim()) {
      errors.carrier = '请填写承运商信息';
    }
    if (!logistics.trackingNumber.trim()) {
      errors.trackingNumber = '请填写物流单号';
    }
    setLogisticsErrors(errors);
    return !errors.carrier && !errors.trackingNumber;
  }, [logistics]);

  const goToStep = useCallback(
    (nextStep: WizardStep) => {
      if (nextStep === 'media' && !validateLogistics()) {
        return;
      }
      if (nextStep === 'review' && mediaItems.length === 0) {
        setSubmitError('请至少上传一份入库媒体');
        return;
      }
      setSubmitError(undefined);
      setActiveStep(nextStep);
    },
    [mediaItems.length, validateLogistics]
  );

  const handleVerify = useCallback(
    async (itemId: string) => {
      const target = mediaItems.find((item) => item.id === itemId);
      if (!target || !target.blake3) return;
      updateVerificationStatus(target.blake3, ORDER_MEDIA_VERIFICATION_STATUSES.RECHECKING);

      setVerifyingIds((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });

      try {
        const { asset, status } = await requestMediaReverification({
          recordUid,
          assetId: target.response?.id,
          hashValue: target.blake3,
          stage: ORDER_MEDIA_STAGES.INBOUND,
          category: target.category
        });

        if (asset) {
          markAsset(asset);
          if (asset.hashValue) {
            updateVerificationStatus(
              asset.hashValue,
              asset.verificationStatus ?? status ?? ORDER_MEDIA_VERIFICATION_STATUSES.VERIFYING,
              { increment: false }
            );
            if (asset.matchedOffchain) {
              markMatched(asset.hashValue, asset.matchedOffchain);
            }
          }
        } else if (status) {
          updateVerificationStatus(target.blake3, status, { increment: false });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '重新验证失败，请稍后重试';
        setSubmitError(message);
        updateVerificationStatus(target.blake3, ORDER_MEDIA_VERIFICATION_STATUSES.FAILED, { increment: false });
      } finally {
        setVerifyingIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [markAsset, markMatched, mediaItems, recordUid, updateVerificationStatus]
  );

  const pollTransaction = useCallback(
    async (hash: string) => {
      const maxAttempts = 8;
      let delay = 1500;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const txn = await aptos.transaction.getTransactionByHash({ transactionHash: hash });
          if ((txn as any)?.type === 'user_transaction') {
            if ((txn as any)?.success === false) {
              throw new Error((txn as any)?.vm_status ?? '链上执行失败');
            }
            return txn;
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
      throw new Error('等待链上确认超时');
    },
    [aptos.transaction]
  );

  const handleSubmit = useCallback(async () => {
    if (!validateLogistics()) {
      setActiveStep('logistics');
      return;
    }
    if (!accountAddress) {
      setSubmitError('请先连接仓主钱包');
      return;
    }
    if (!orderDetail?.orderId) {
      setSubmitError('订单信息缺失，无法提交入库');
      return;
    }

    setSubmitError(undefined);
    setSubmitting(true);
    setTransactionState({ stage: 'submitting' });

    try {
      await uploadAll();
      const latestItems = mediaItemsRef.current;

      if (!latestItems.length) {
        throw new Error('请先上传至少一份入库媒体');
      }

      const pendingUploads = latestItems.filter((item) => item.uploadStatus !== 'uploaded');
      if (pendingUploads.length > 0) {
        setActiveStep('media');
        throw new Error(`仍有 ${pendingUploads.length} 个媒体未成功上传`);
      }

      const canonical = latestItems.find((item) => item.uploadStatus === 'uploaded' && item.blake3);
      if (!canonical?.blake3) {
        throw new Error('未找到可用的媒体哈希');
      }

      const inboundLogistics = deriveInboundLogistics(logistics) ?? `${logistics.carrier.trim()}#${logistics.trackingNumber.trim()}`;
      const mediaBytes = Array.from(hexToBytes(canonical.blake3));

      updateVerificationStatus(canonical.blake3, ORDER_MEDIA_VERIFICATION_STATUSES.VERIFYING, { increment: false });

      const transaction = await aptos.transaction.build.simple({
        sender: accountAddress,
        data: {
          function: CHECK_IN_FUNCTION,
          functionArguments: [orderDetail.orderId, inboundLogistics, canonical.category, mediaBytes]
        }
      });

      const [simulation] = await aptos.transaction.simulate.simple({ transaction });
      if (simulation && (simulation as any)?.success === false) {
        throw new Error((simulation as any)?.vm_status ?? '交易模拟失败');
      }

      const result = await signAndSubmitTransaction(transaction);
      const txnHash = resolveTransactionHash(result);
      if (!txnHash) {
        throw new Error('钱包未返回交易哈希');
      }

      const explorerUrl = buildExplorerUrl(txnHash, networkStatus.expected);
      setTransactionState({ stage: 'pending', hash: txnHash, explorerUrl });

      await pollTransaction(txnHash);
      updateVerificationStatus(canonical.blake3, ORDER_MEDIA_VERIFICATION_STATUSES.VERIFIED, { increment: false });

      try {
        const updatedDetail = await fetchOrderDetail(recordUid);
        if (updatedDetail) {
          setOrderDetail(updatedDetail);
          updatedDetail.mediaAssets?.forEach((asset) => markAsset(asset));
        }
      } catch (error) {
        console.warn('[HaiGo] failed to refresh order detail after check_in', error);
      }

      setTransactionState({ stage: 'success', hash: txnHash, explorerUrl });
      setSubmitError(undefined);
      void clearInboundMediaDraft(recordUid);
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交失败，请稍后重试';
      setSubmitError(message);
      setTransactionState((prev) => ({
        stage: 'failed',
        hash: prev.hash,
        explorerUrl: prev.explorerUrl,
        error: message
      }));
    } finally {
      setSubmitting(false);
    }
  }, [
    accountAddress,
    aptos.transaction,
    markAsset,
    networkStatus.expected,
    orderDetail?.orderId,
    pollTransaction,
    recordUid,
    signAndSubmitTransaction,
    uploadAll,
    validateLogistics,
    logistics,
    updateVerificationStatus
  ]);

  const slaMessage = useMemo(() => {
    if (!sla) return '入库 SLA：待指派';
    const dueFormatted = formatTime(new Date(sla.due).toISOString());
    if (sla.isOverdue) {
      const overdueMinutes = Math.round(Math.abs(sla.remaining) / 60000);
      return `⚠ 已超出 SLA ${overdueMinutes} 分钟（截止 ${dueFormatted}）`;
    }
    const remainingMinutes = Math.max(1, Math.round(sla.remaining / 60000));
    return `入库 SLA：剩余 ${remainingMinutes} 分钟（截止 ${dueFormatted}）`;
  }, [sla]);

  return (
    <NetworkGuard>
      <div className="check-in-layout" data-step={activeStep}>
        <header className="page-header">
          <div>
            <h1>订单入库核验</h1>
            <p className="subtitle">记录 UID：{recordUid}</p>
          </div>
          <div className="sla-indicator" aria-live="polite">
            {slaMessage}
          </div>
        </header>

        <WalletGate
          walletStatus={walletStatus}
          availableWallets={availableWallets}
          onConnect={connect}
        />

        <StepIndicator activeStep={activeStep} />

        <section className="task-summary" aria-live="polite">
          <h2>任务概览</h2>
          {orderLoading && <p>正在加载订单详情...</p>}
          {orderError && <p className="error">{orderError}</p>}
          {orderDetail && (
            <dl>
              <div>
                <dt>当前状态</dt>
                <dd>{resolveStatusLabel(orderDetail.status)}</dd>
              </div>
              <div>
                <dt>仓主地址</dt>
                <dd>{orderDetail.warehouseAddress}</dd>
              </div>
              <div>
                <dt>最近更新时间</dt>
                <dd>{formatTime(orderDetail.updatedAt || orderDetail.createdAt)}</dd>
              </div>
              <div>
                <dt>时间线节点</dt>
                <dd>{orderDetail.timeline?.length ?? 0} 项</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="logistics-panel" hidden={activeStep !== 'logistics'}>
          <h2>物流信息</h2>
          <p className="helper-text">填写物流单号与承运商，以便链下系统确认入库任务。</p>
          <div className="form-grid">
            <label htmlFor="carrier">
              承运商
              <input
                id="carrier"
                name="carrier"
                type="text"
                required
                autoComplete="organization"
                value={logistics.carrier}
                onChange={(event) => handleLogisticsChange('carrier', event.target.value)}
                aria-invalid={Boolean(logisticsErrors.carrier)}
                aria-describedby={logisticsErrors.carrier ? 'carrier-error' : undefined}
              />
              {logisticsErrors.carrier && (
                <span id="carrier-error" role="alert" className="error">
                  {logisticsErrors.carrier}
                </span>
              )}
            </label>

            <label htmlFor="trackingNumber">
              物流单号
              <input
                id="trackingNumber"
                name="trackingNumber"
                type="text"
                required
                value={logistics.trackingNumber}
                onChange={(event) => handleLogisticsChange('trackingNumber', event.target.value)}
                aria-invalid={Boolean(logisticsErrors.trackingNumber)}
                aria-describedby={logisticsErrors.trackingNumber ? 'trackingNumber-error' : undefined}
              />
              {logisticsErrors.trackingNumber && (
                <span id="trackingNumber-error" role="alert" className="error">
                  {logisticsErrors.trackingNumber}
                </span>
              )}
            </label>

            <label htmlFor="notes" className="notes">
              备注（可选）
              <textarea
                id="notes"
                name="notes"
                rows={3}
                value={logistics.notes}
                onChange={(event) => handleLogisticsChange('notes', event.target.value)}
              />
            </label>
          </div>

          <div className="actions">
            <button type="button" className="primary" onClick={() => goToStep('media')}>
              下一步：上传媒体
            </button>
          </div>
        </section>

        <section className="media-panel" hidden={activeStep !== 'media'}>
          <h2>上传入库媒体</h2>
          <p className="helper-text">支持拖拽、移动拍摄或批量选择。图片 ≤ 15MB，视频 ≤ 200MB。</p>

          <Dropzone onFilesSelected={addFiles} disabled={walletStatus !== 'connected'} />

          <div className="media-list" role="list">
            {mediaItems.map((item) => (
              <article key={item.id} role="listitem" className="media-card">
                <header>
                  <div>
                    <h3>{item.fileName}</h3>
                    <p>{deriveMediaCaption(item.category)}</p>
                  </div>
                  <div className="meta">
                    <span>{formatBytes(item.fileSize)}</span>
                    <VerificationBadge status={item.verificationStatus} attempts={item.verificationAttempts} />
                  </div>
                </header>

                <dl className="hashes">
                  <div>
                    <dt>{primaryHashAlgorithm}</dt>
                    <dd>{item.blake3 ?? '计算中...'}</dd>
                  </div>
                  {secondaryHashAlgorithm && (
                    <div>
                      <dt>{secondaryHashAlgorithm}</dt>
                      <dd>{item.keccak256 ?? '可选校验处理中...'}</dd>
                    </div>
                  )}
                </dl>

                <div className="status-row">
                  {item.uploadStatus === 'uploading' && (
                    <progress max={1} value={item.uploadProgress} aria-label="上传进度" />
                  )}
                  {item.uploadStatus === 'error' && <span className="error">{item.uploadError}</span>}
                  {item.matchedOffchain && <span className="success">已与链下记录匹配</span>}
                </div>

                <footer>
                  <button type="button" onClick={() => removeItem(item.id)} className="ghost">
                    移除
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => uploadItem(item.id)}
                    disabled={item.hashStatus !== 'ready' || item.uploadStatus === 'uploading'}
                  >
                    {item.uploadStatus === 'uploaded' ? '重新上传' : '上传'}
                  </button>
                  <MediaVerificationActions
                    disabled={!item.blake3 || verifyingIds.has(item.id)}
                    onVerify={() => void handleVerify(item.id)}
                  />
                </footer>
              </article>
            ))}
          </div>

          {mediaItems.length === 0 && <p className="empty">尚未选择媒体文件。</p>}

          <div className="messages" aria-live="polite">
            {mediaMessages.map((message) => (
              <div key={message.id} className={`message ${message.type}`}>
                <span>{message.message}</span>
                <button type="button" onClick={() => dismissMessage(message.id)} aria-label="关闭提示">
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="actions">
            <button type="button" onClick={() => goToStep('logistics')} className="ghost">
              上一步
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => goToStep('review')}
              disabled={mediaItems.length === 0}
            >
              下一步：确认提交
            </button>
          </div>
        </section>

        <section className="review-panel" hidden={activeStep !== 'review'}>
          <h2>确认入库信息</h2>
          <div className="summary-card">
            <h3>物流信息</h3>
            <dl>
              <div>
                <dt>承运商</dt>
                <dd>{logistics.carrier}</dd>
              </div>
              <div>
                <dt>物流单号</dt>
                <dd>{logistics.trackingNumber}</dd>
              </div>
              {logistics.notes && (
                <div>
                  <dt>备注</dt>
                  <dd>{logistics.notes}</dd>
                </div>
              )}
              <div>
                <dt>钱包地址</dt>
                <dd>{accountAddress ?? '未连接'}</dd>
              </div>
            </dl>
          </div>

          <div className="summary-card">
            <h3>媒体文件</h3>
            <ul>
              {mediaItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.fileName}</strong> · {formatBytes(item.fileSize)} ·{' '}
                  {item.uploadStatus === 'uploaded' ? '已上传' : '待上传'}
                </li>
              ))}
            </ul>
          </div>

          {transactionState.stage !== 'idle' && (
            <div className={`transaction-state ${transactionState.stage}`} role="status">
              {transactionState.stage === 'submitting' && <p>正在准备链上交易，请稍候...</p>}
              {transactionState.stage === 'pending' && (
                <p>
                  交易已提交，等待链上确认。
                  {transactionState.hash && (
                    <>
                      {' '}
                      哈希：<code>{transactionState.hash}</code>
                    </>
                  )}
                  {transactionState.explorerUrl && (
                    <>
                      {' · '}
                      <a href={transactionState.explorerUrl} target="_blank" rel="noreferrer">
                        查看 Explorer
                      </a>
                    </>
                  )}
                </p>
              )}
              {transactionState.stage === 'success' && (
                <p className="success">链上入库成功，时间线即将更新。</p>
              )}
              {transactionState.stage === 'failed' && (
                <p className="error">提交失败：{transactionState.error ?? '请稍后重试'}</p>
              )}
            </div>
          )}

          {submitError && <p className="error" role="alert">{submitError}</p>}

          <div className="actions">
            <button type="button" onClick={() => goToStep('media')} className="ghost">
              返回修改
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void handleSubmit()}
              disabled={submitting || isProcessing}
            >
              {submitting ? '提交中...' : '提交链上入库'}
            </button>
          </div>
        </section>

        <aside className="timeline" aria-live="polite">
          <h2>订单时间线</h2>
          <ul>
            {orderDetail?.timeline?.map((item) => (
              <li key={`${item.stage}-${item.occurredAt}`}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{formatTime(item.occurredAt)}</span>
                </div>
                {item.details && <p>{item.details}</p>}
                {item.mediaAssets?.length ? (
                  <ul className="timeline-media">
                    {item.mediaAssets.map((asset) => (
                      <li key={asset.hashValue}>
                        {deriveMediaCaption(asset.category)} · {asset.hashValue}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </NetworkGuard>
  );
}

interface DropzoneProps {
  onFilesSelected: (files: FileList) => void;
  disabled?: boolean;
}

const Dropzone = ({ onFilesSelected, disabled }: DropzoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const files = event.dataTransfer.files;
      if (files?.length) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) {
        onFilesSelected(event.target.files);
        event.target.value = '';
      }
    },
    [onFilesSelected]
  );

  return (
    <div
      className={`dropzone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
    >
      <p>拖拽文件到此处，或点击选择（移动端支持直接拍摄）</p>
      <input
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        capture="environment"
        onChange={handleInputChange}
        aria-hidden
        disabled={disabled}
      />
    </div>
  );
};
