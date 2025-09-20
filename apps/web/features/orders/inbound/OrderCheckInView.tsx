'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';
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

const computeSlaCountdown = (createdAt?: string) => {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const slaMs = 2 * 60 * 60 * 1000; // 2 hour inbound SLA
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
    [ORDER_MEDIA_VERIFICATION_STATUSES.PENDING]: { label: 'Pending verification', tone: 'neutral' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.VERIFYING]: { label: 'Verifying', tone: 'warning' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.VERIFIED]: { label: 'Verified', tone: 'success' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.FAILED]: { label: 'Verification failed', tone: 'danger' },
    [ORDER_MEDIA_VERIFICATION_STATUSES.RECHECKING]: { label: 'Rechecking', tone: 'warning' }
  };

  const { label, tone } = labelMap[status] ?? labelMap[ORDER_MEDIA_VERIFICATION_STATUSES.PENDING];

  return (
    <span className={`badge badge-${tone}`} aria-live="polite">
      {label}
      {attempts > 1 ? ` (attempt ${attempts})` : ''}
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
      Retry verification
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
      <h2>Connect the warehouse wallet to continue</h2>
      <p>The warehouse wallet must sign the inbound submission. Please connect it first.</p>
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
    { id: 'logistics', label: 'Step 1', description: 'Fill in logistics details' },
    { id: 'media', label: 'Step 2', description: 'Upload inbound media' },
    { id: 'review', label: 'Step 3', description: 'Confirm and submit on-chain' }
  ];

  return (
    <ol className="step-indicator" aria-label="Inbound process steps">
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
      return 'Inbound photo evidence';
    case ORDER_MEDIA_CATEGORIES.INBOUND_VIDEO:
      return 'Inbound video evidence';
    case ORDER_MEDIA_CATEGORIES.INBOUND_DOCUMENT:
      return 'Inbound document proof';
    default:
      return 'Inbound media';
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
        setOrderError(error instanceof Error ? error.message : 'Unable to load order details');
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
      errors.carrier = 'Please provide the carrier information';
    }
    if (!logistics.trackingNumber.trim()) {
      errors.trackingNumber = 'Please provide the tracking number';
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
        setSubmitError('Please upload at least one inbound media file');
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
        const message = error instanceof Error ? error.message : 'Verification retry failed, please try again later';
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
              throw new Error((txn as any)?.vm_status ?? 'On-chain execution failed');
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
      throw new Error('Timed out waiting for on-chain confirmation');
    },
    [aptos.transaction]
  );

  const handleSubmit = useCallback(async () => {
    if (!validateLogistics()) {
      setActiveStep('logistics');
      return;
    }
    if (!accountAddress) {
      setSubmitError('Please connect the warehouse wallet first');
      return;
    }
    if (!orderDetail?.orderId) {
      setSubmitError('Order information is incomplete; inbound submission is unavailable');
      return;
    }

    setSubmitError(undefined);
    setSubmitting(true);
    setTransactionState({ stage: 'submitting' });

    try {
      await uploadAll();
      const latestItems = mediaItemsRef.current;

      if (!latestItems.length) {
        throw new Error('Upload at least one inbound media file first');
      }

      const pendingUploads = latestItems.filter((item) => item.uploadStatus !== 'uploaded');
      if (pendingUploads.length > 0) {
        setActiveStep('media');
        throw new Error(`${pendingUploads.length} media file(s) have not finished uploading`);
      }

      const canonical = latestItems.find((item) => item.uploadStatus === 'uploaded' && item.blake3);
      if (!canonical?.blake3) {
        throw new Error('No media hash available');
      }

      const inboundLogistics = deriveInboundLogistics(logistics) ?? `${logistics.carrier.trim()}#${logistics.trackingNumber.trim()}`;
      const mediaBytes = Array.from(hexToBytes(canonical.blake3));

      updateVerificationStatus(canonical.blake3, ORDER_MEDIA_VERIFICATION_STATUSES.VERIFYING, { increment: false });

      const payload = {
        function: CHECK_IN_FUNCTION,
        functionArguments: [orderDetail.orderId, inboundLogistics, canonical.category, mediaBytes]
      } satisfies InputGenerateTransactionPayloadData;

      const transaction = await aptos.transaction.build.simple({
        sender: accountAddress,
        data: payload
      });

      const [simulation] = await aptos.transaction.simulate.simple({ transaction });
      if (simulation && (simulation as any)?.success === false) {
        throw new Error((simulation as any)?.vm_status ?? 'Transaction simulation failed');
      }

      const result = await signAndSubmitTransaction({
        sender: accountAddress,
        data: payload
      });
      const txnHash = resolveTransactionHash(result);
      if (!txnHash) {
        throw new Error('Wallet did not return a transaction hash');
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
      const message = error instanceof Error ? error.message : 'Submission failed, please try again later';
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
    if (!sla) return 'Inbound SLA: awaiting assignment';
    const dueFormatted = formatTime(new Date(sla.due).toISOString());
    if (sla.isOverdue) {
      const overdueMinutes = Math.round(Math.abs(sla.remaining) / 60000);
      return `⚠ SLA exceeded by ${overdueMinutes} minute(s) (deadline ${dueFormatted})`;
    }
    const remainingMinutes = Math.max(1, Math.round(sla.remaining / 60000));
    return `Inbound SLA: ${remainingMinutes} minute(s) remaining (deadline ${dueFormatted})`;
  }, [sla]);

  return (
    <NetworkGuard>
      <div className="check-in-layout" data-step={activeStep}>
        <header className="page-header">
          <div>
            <h1>Order inbound verification</h1>
            <p className="subtitle">Record UID: {recordUid}</p>
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
          <h2>Task overview</h2>
          {orderLoading && <p>Loading order details...</p>}
          {orderError && <p className="error">{orderError}</p>}
          {orderDetail && (
            <dl>
              <div>
                <dt>Current status</dt>
                <dd>{resolveStatusLabel(orderDetail.status)}</dd>
              </div>
              <div>
                <dt>Warehouse address</dt>
                <dd>{orderDetail.warehouseAddress}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatTime(orderDetail.updatedAt || orderDetail.createdAt)}</dd>
              </div>
              <div>
                <dt>Timeline events</dt>
                <dd>{orderDetail.timeline?.length ?? 0}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="logistics-panel" hidden={activeStep !== 'logistics'}>
          <h2>Logistics details</h2>
          <p className="helper-text">Provide the carrier and tracking number so off-chain systems can verify the inbound task.</p>
          <div className="form-grid">
            <label htmlFor="carrier">
              Carrier
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
              Tracking number
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
              Notes (optional)
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
              Next: Upload media
            </button>
          </div>
        </section>

        <section className="media-panel" hidden={activeStep !== 'media'}>
          <h2>Upload inbound media</h2>
          <p className="helper-text">Drag and drop, capture on mobile, or select files in bulk. Images ≤ 15MB, videos ≤ 200MB.</p>

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
                    <dd>{item.blake3 ?? 'Calculating...'}</dd>
                  </div>
                  {secondaryHashAlgorithm && (
                    <div>
                      <dt>{secondaryHashAlgorithm}</dt>
                      <dd>{item.keccak256 ?? 'Optional cross-check in progress...'}</dd>
                    </div>
                  )}
                </dl>

                <div className="status-row">
                  {item.uploadStatus === 'uploading' && (
                    <progress max={1} value={item.uploadProgress} aria-label="Upload progress" />
                  )}
                  {item.uploadStatus === 'error' && <span className="error">{item.uploadError}</span>}
                  {item.matchedOffchain && <span className="success">Matched with off-chain record</span>}
                </div>

                <footer>
                  <button type="button" onClick={() => removeItem(item.id)} className="ghost">
                    Remove
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => uploadItem(item.id)}
                    disabled={item.hashStatus !== 'ready' || item.uploadStatus === 'uploading'}
                  >
                    {item.uploadStatus === 'uploaded' ? 'Re-upload' : 'Upload'}
                  </button>
                  <MediaVerificationActions
                    disabled={!item.blake3 || verifyingIds.has(item.id)}
                    onVerify={() => void handleVerify(item.id)}
                  />
                </footer>
              </article>
            ))}
          </div>

      {mediaItems.length === 0 && <p className="empty">No media files selected yet.</p>}

          <div className="messages" aria-live="polite">
            {mediaMessages.map((message) => (
              <div key={message.id} className={`message ${message.type}`}>
                <span>{message.message}</span>
                <button type="button" onClick={() => dismissMessage(message.id)} aria-label="Dismiss alert">
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="actions">
            <button type="button" onClick={() => goToStep('logistics')} className="ghost">
              Previous step
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => goToStep('review')}
              disabled={mediaItems.length === 0}
            >
              Next: Review & submit
            </button>
          </div>
        </section>

        <section className="review-panel" hidden={activeStep !== 'review'}>
          <h2>Review inbound submission</h2>
          <div className="summary-card">
            <h3>Logistics</h3>
            <dl>
              <div>
                <dt>Carrier</dt>
                <dd>{logistics.carrier}</dd>
              </div>
              <div>
                <dt>Tracking number</dt>
                <dd>{logistics.trackingNumber}</dd>
              </div>
              {logistics.notes && (
                <div>
                  <dt>Notes</dt>
                  <dd>{logistics.notes}</dd>
                </div>
              )}
              <div>
                <dt>Wallet address</dt>
                <dd>{accountAddress ?? 'Not connected'}</dd>
              </div>
            </dl>
          </div>

          <div className="summary-card">
            <h3>Media files</h3>
            <ul>
              {mediaItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.fileName}</strong> · {formatBytes(item.fileSize)} ·{' '}
                  {item.uploadStatus === 'uploaded' ? 'Uploaded' : 'Pending upload'}
                </li>
              ))}
            </ul>
          </div>

          {transactionState.stage !== 'idle' && (
            <div className={`transaction-state ${transactionState.stage}`} role="status">
              {transactionState.stage === 'submitting' && <p>Preparing on-chain transaction, please wait...</p>}
              {transactionState.stage === 'pending' && (
                <p>
                  Transaction submitted, awaiting on-chain confirmation.
                  {transactionState.hash && (
                    <>
                      {' '}
                      Hash: <code>{transactionState.hash}</code>
                    </>
                  )}
                  {transactionState.explorerUrl && (
                    <>
                      {' · '}
                      <a href={transactionState.explorerUrl} target="_blank" rel="noreferrer">
                        Open Explorer
                      </a>
                    </>
                  )}
                </p>
              )}
              {transactionState.stage === 'success' && (
                <p className="success">Inbound submission succeeded on-chain. The timeline will refresh shortly.</p>
              )}
              {transactionState.stage === 'failed' && (
                <p className="error">Submission failed: {transactionState.error ?? 'Please try again later'}</p>
              )}
            </div>
          )}

          {submitError && <p className="error" role="alert">{submitError}</p>}

          <div className="actions">
            <button type="button" onClick={() => goToStep('media')} className="ghost">
              Back to edits
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void handleSubmit()}
              disabled={submitting || isProcessing}
            >
              {submitting ? 'Submitting...' : 'Submit inbound on-chain'}
            </button>
          </div>
        </section>

        <aside className="timeline" aria-live="polite">
          <h2>Order timeline</h2>
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
      <p>Drag and drop files here, or click to choose (mobile devices support direct capture).</p>
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
