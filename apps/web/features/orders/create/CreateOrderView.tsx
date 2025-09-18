'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ORDER_DEFAULTS,
  ORDER_EVENT_TYPES,
  ORDER_FORM_CACHE_KEY,
  ORDER_MEDIA_STAGES,
  ORDERS_MODULE_ADDRESS,
  ORDERS_MODULE_NAME,
  ORDER_STATUS_LABELS,
  APTOS_COIN_TYPE
} from '@shared/config';
import {
  type LogisticsInfo,
  type OrderDetailDto,
  type OrderSummaryDto,
  type WarehouseSummary,
  calculatePricing,
  deriveRecordUid,
  formatSubunitsToApt,
  OCTA_PER_APT
} from '@shared/dto/orders';
import { fetchOrderDetail, fetchOrderSummaries, fetchWarehouses } from '../../../lib/api/orders';
import { hexToBytes } from '../../../lib/crypto/hex';
import { NetworkGuard } from '../../../lib/wallet/network-guard';
import { useWalletContext } from '../../../lib/wallet/context';
import { deriveInboundLogistics } from '../utils';

const STEPS = ['warehouse', 'pricing', 'review'] as const;
type WizardStep = (typeof STEPS)[number];

type SimulationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; gasUsed: number; gasUnitPrice: number; estimatedFee: number; transaction: any };

type TransactionStage = 'idle' | 'submitting' | 'pending' | 'success' | 'failed';

interface TransactionState {
  stage: TransactionStage;
  hash?: string;
  explorerUrl?: string;
  error?: string;
}

interface OrderFormState extends LogisticsInfo {
  warehouseId?: string;
  amountApt: string;
  insuranceRate: number;
  platformFeeRate: number;
  mediaHash?: string;
  mediaCategory: string;
}

interface OptimisticOrderSnapshot {
  recordUid: string;
  orderId: number;
  transactionHash: string;
  createdAt: string;
}

const MEDIA_HASH_REGEX = /^[0-9a-f]{64}$/;
const EXPLORER_BASE_URL = 'https://explorer.aptoslabs.com/txn/';

const initialFormState: OrderFormState = {
  warehouseId: undefined,
  amountApt: '1',
  insuranceRate: ORDER_DEFAULTS.insuranceRateBps / 100,
  platformFeeRate: ORDER_DEFAULTS.platformFeeBps / 100,
  mediaCategory: ORDER_MEDIA_STAGES.INBOUND,
  carrier: '',
  trackingNumber: '',
  notes: ''
};

const buildExplorerUrl = (hash: string, network: string) => `${EXPLORER_BASE_URL}${hash}?network=${network}`;

const parseCachedForm = (): OrderFormState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ORDER_FORM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OrderFormState>;
    return {
      ...initialFormState,
      ...parsed,
      amountApt: parsed.amountApt ?? initialFormState.amountApt,
      insuranceRate: typeof parsed.insuranceRate === 'number' ? parsed.insuranceRate : initialFormState.insuranceRate,
      platformFeeRate:
        typeof parsed.platformFeeRate === 'number' ? parsed.platformFeeRate : initialFormState.platformFeeRate
    } satisfies OrderFormState;
  } catch (error) {
    console.warn('[HaiGo] unable to parse cached order form', error);
    return null;
  }
};

const persistForm = (state?: OrderFormState | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (!state) {
      window.sessionStorage.removeItem(ORDER_FORM_CACHE_KEY);
      return;
    }
    window.sessionStorage.setItem(ORDER_FORM_CACHE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[HaiGo] failed to cache order form', error);
  }
};

export function CreateOrderView() {
  const {
    status,
    accountAddress,
    networkStatus,
    signAndSubmitTransaction,
    aptos
  } = useWalletContext();

  const [step, setStep] = useState<WizardStep>('warehouse');
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [warehousesError, setWarehousesError] = useState<string>();
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  const [formState, setFormState] = useState<OrderFormState>(() => parseCachedForm() ?? initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [simulationState, setSimulationState] = useState<SimulationState>({ status: 'idle' });
  const [transactionState, setTransactionState] = useState<TransactionState>({ stage: 'idle' });
  const [optimisticOrder, setOptimisticOrder] = useState<OptimisticOrderSnapshot | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetailDto | null>(null);
  const [orderList, setOrderList] = useState<OrderSummaryDto[]>([]);

  const resolvedRecordUid = orderDetail?.recordUid ?? optimisticOrder?.recordUid;

  const selectedWarehouse = useMemo(() => {
    if (!formState.warehouseId) return undefined;
    return warehouses.find((item) => item.id === formState.warehouseId);
  }, [formState.warehouseId, warehouses]);

  const pricing = useMemo(() => {
    const amount = Number.parseFloat(formState.amountApt) || 0;
    const insuranceBps = Math.round(formState.insuranceRate * 100);
    const platformBps = Math.round(formState.platformFeeRate * 100);
    return calculatePricing({ amountApt: amount, insuranceRateBps: insuranceBps, platformFeeBps: platformBps });
  }, [formState.amountApt, formState.insuranceRate, formState.platformFeeRate]);

  useEffect(() => {
    let cancelled = false;
    setWarehousesLoading(true);
    fetchWarehouses()
      .then((items) => {
        if (cancelled) return;
        setWarehouses(items);
        if (!formState.warehouseId && items.length > 0) {
          setFormState((prev) => ({ ...prev, warehouseId: items[0].id }));
        }
        setWarehousesLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setWarehousesError(error instanceof Error ? error.message : String(error));
        setWarehousesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    persistForm(formState);
  }, [formState]);
  const updateForm = useCallback(
    (patch: Partial<OrderFormState>) => {
      setFormState((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const clearTransientState = useCallback(() => {
    setSimulationState({ status: 'idle' });
    setTransactionState({ stage: 'idle' });
    setOrderDetail(null);
    setOptimisticOrder(null);
  }, []);

  const validateStep = useCallback(
    (target: WizardStep) => {
      const nextErrors: Record<string, string> = {};

      if (target === 'warehouse' && !formState.warehouseId) {
        nextErrors.warehouseId = 'Select a warehouse.';
      }

      if (target === 'pricing') {
        const amount = Number.parseFloat(formState.amountApt);
        if (!Number.isFinite(amount) || amount <= 0) {
          nextErrors.amountApt = 'Enter a positive amount in APT.';
        }
        if (formState.mediaHash && !MEDIA_HASH_REGEX.test(formState.mediaHash.trim())) {
          nextErrors.mediaHash = 'Media hash must be a 64 character lowercase hex string.';
        }
      }

      setErrors(nextErrors);
      return Object.keys(nextErrors).length === 0;
    },
    [formState.amountApt, formState.mediaHash, formState.warehouseId]
  );

  const goToStep = useCallback(
    (next: WizardStep) => {
      if (next === 'pricing') {
        setStep(next);
        clearTransientState();
        return;
      }
      if (next === 'review' && !validateStep('pricing')) return;
      setStep(next);
      clearTransientState();
    },
    [clearTransientState, validateStep]
  );
  const buildFunctionAddress = useMemo(
    () => `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::create_order` as `${string}::${string}::${string}`,
    []
  );

  const buildTransaction = useCallback(async () => {
    if (!accountAddress) {
      throw new Error('Connect your wallet before submitting an order.');
    }

    const inboundLogistics = deriveInboundLogistics({
      carrier: formState.carrier,
      trackingNumber: formState.trackingNumber,
      notes: formState.notes
    });

    const mediaHash = formState.mediaHash?.trim();
    const mediaCategory = mediaHash ? formState.mediaCategory : null;
    const mediaBytes = mediaHash ? Array.from(hexToBytes(mediaHash)) : null;

    return aptos.transaction.build.simple({
      sender: accountAddress,
      data: {
        function: buildFunctionAddress,
        typeArguments: [APTOS_COIN_TYPE],
        functionArguments: [
          selectedWarehouse?.address ?? formState.warehouseId,
          inboundLogistics ?? null,
          pricing.amountSubunits.toString(),
          pricing.insuranceFeeSubunits.toString(),
          pricing.platformFeeSubunits.toString(),
          mediaCategory,
          mediaBytes ?? null
        ]
      }
    });
  }, [
    accountAddress,
    aptos.transaction,
    buildFunctionAddress,
    formState.carrier,
    formState.mediaCategory,
    formState.mediaHash,
    formState.notes,
    formState.trackingNumber,
    formState.warehouseId,
    pricing.amountSubunits,
    pricing.insuranceFeeSubunits,
    pricing.platformFeeSubunits,
    selectedWarehouse?.address
  ]);

  const simulateOrder = useCallback(async () => {
    if (!accountAddress) {
      setSimulationState({ status: 'error', message: 'Connect your wallet before simulating.' });
      return;
    }

    setSimulationState({ status: 'loading' });
    try {
      const transaction = await buildTransaction();
      const [result] = await aptos.transaction.simulate.simple({ transaction });
      if (!result) {
        throw new Error('Simulation returned no results.');
      }
      if ((result as any)?.success === false) {
        throw new Error((result as any)?.vm_status ?? 'Simulation failed.');
      }
      const gasUsed = Number((result as any).gas_used ?? (result as any).gasUsed ?? 0);
      const gasUnitPrice = Number((result as any).gas_unit_price ?? (result as any).gasUnitPrice ?? 0);
      setSimulationState({
        status: 'success',
        transaction,
        gasUsed,
        gasUnitPrice,
        estimatedFee: ((gasUsed || 0) * (gasUnitPrice || 0)) / OCTA_PER_APT
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Simulation failed';
      setSimulationState({ status: 'error', message });
    }
  }, [accountAddress, aptos.transaction.simulate, buildTransaction]);

  const pollTransaction = useCallback(
    async (hash: string) => {
      const maxAttempts = 8;
      let delay = 1500;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const txn = await aptos.transaction.getTransactionByHash({ transactionHash: hash });
          if ((txn as any)?.type === 'user_transaction') {
            if ((txn as any)?.success === false) {
              throw new Error((txn as any)?.vm_status ?? 'Transaction failed on-chain.');
            }
            return txn as any;
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
      throw new Error('Transaction confirmation timed out.');
    },
    [aptos.transaction]
  );

  const refreshOrders = useCallback(async () => {
    try {
      const list = await fetchOrderSummaries();
      setOrderList(list);
    } catch (error) {
      console.warn('[HaiGo] failed to refresh order list', error);
    }
  }, []);
  const submitOrder = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!validateStep('pricing')) {
        setStep('pricing');
        return;
      }
      if (!accountAddress) {
        setTransactionState({ stage: 'failed', error: 'Connect your wallet before submitting the order.' });
        return;
      }

      setTransactionState({ stage: 'submitting' });
      try {
        const transaction =
          simulationState.status === 'success' ? simulationState.transaction : await buildTransaction();
        const result = await signAndSubmitTransaction(transaction);
        const txnHash =
          typeof result === 'string'
            ? result
            : result?.hash ??
              (typeof (result as any)?.transactionHash === 'string'
                ? (result as any).transactionHash
                : undefined) ??
              (typeof (result as any)?.txnHash === 'string' ? (result as any).txnHash : undefined) ??
              (typeof (result as any)?.result?.hash === 'string' ? (result as any).result.hash : undefined);
        if (!txnHash) {
          throw new Error('Wallet did not return a transaction hash.');
        }

        const explorerUrl = buildExplorerUrl(txnHash, networkStatus.expected);
        setTransactionState({ stage: 'pending', hash: txnHash, explorerUrl });
        setOptimisticOrder({
          transactionHash: txnHash,
          orderId: Date.now(),
          recordUid: deriveRecordUid(Date.now(), txnHash),
          createdAt: new Date().toISOString()
        });

        const confirmed = await pollTransaction(txnHash);
        const event = (confirmed?.events ?? []).find((evt: any) =>
          String(evt?.type ?? '').includes(ORDER_EVENT_TYPES.ORDER_CREATED)
        );
        const orderId = Number.parseInt(event?.data?.order_id ?? event?.data?.orderId ?? '0', 10);
        const recordUid = orderId > 0 ? deriveRecordUid(orderId, txnHash) : deriveRecordUid(Date.now(), txnHash);

        try {
          const detail = await fetchOrderDetail(recordUid);
          if (detail) {
            setOrderDetail(detail);
          }
        } catch (error) {
          console.warn('[HaiGo] order detail not yet available', error);
        }

        setTransactionState({ stage: 'success', hash: txnHash, explorerUrl });
        setOptimisticOrder({
          transactionHash: txnHash,
          orderId: orderId || Date.now(),
          recordUid,
          createdAt: new Date().toISOString()
        });
        void refreshOrders();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Order transaction failed.';
        const normalized = message.toLowerCase();
        const friendly = normalized.includes('reject') ? 'Signature request declined in wallet.' : message;
        setTransactionState({ stage: 'failed', error: friendly });
      }
    },
    [
      validateStep,
      accountAddress,
      simulationState,
      buildTransaction,
      signAndSubmitTransaction,
      networkStatus.expected,
      pollTransaction,
      clearTransientState,
      refreshOrders
    ]
  );
  const pricingRows = useMemo(
    () => [
      { label: 'Order amount', value: formatSubunitsToApt(pricing.amountSubunits, pricing.precision) },
      { label: 'Insurance fee', value: formatSubunitsToApt(pricing.insuranceFeeSubunits, pricing.precision) },
      { label: 'Platform fee', value: formatSubunitsToApt(pricing.platformFeeSubunits, pricing.precision) },
      { label: 'Total debit', value: formatSubunitsToApt(pricing.totalSubunits, pricing.precision) }
    ],
    [pricing]
  );

  return (
    <div className="order-create-shell" data-step={step}>
      <div className="order-create__header">
        <h1 className="order-create__title">Create a new order</h1>
        <p className="order-create__subtitle">
          Choose a warehouse, configure fee breakdowns, and sign the on-chain order creation transaction.
        </p>
      </div>

      <ol className="order-create__steps" aria-label="Order creation steps">
        {STEPS.map((item) => (
          <li key={item} className={step === item ? 'active' : ''}>
            <span className="order-create__step-label">
              {item === 'warehouse' ? 'Select warehouse' : item === 'pricing' ? 'Configure fees' : 'Review & sign'}
            </span>
          </li>
        ))}
      </ol>

      {step === 'warehouse' && (
        <section className="warehouse-picker" aria-live="polite">
          {warehousesLoading && <p>Loading warehouse availability…</p>}
          {warehousesError && <p className="order-create__error">{warehousesError}</p>}
          <div className="warehouse-grid">
            {warehouses.map((warehouse) => (
              <article key={warehouse.id} className="warehouse-card">
                <header className="warehouse-card__header">
                  <h2>{warehouse.name}</h2>
                  <span className={`warehouse-card__badge warehouse-card__badge--${warehouse.availability}`}>
                    {warehouse.availability}
                  </span>
                </header>
                <dl className="warehouse-card__metrics">
                  <div>
                    <dt>Staking信用</dt>
                    <dd>{warehouse.stakingScore.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>信用限额</dt>
                    <dd>{warehouse.creditCapacity.toLocaleString()} APT</dd>
                  </div>
                  {warehouse.insuranceCoverage && (
                    <div>
                      <dt>保险覆盖</dt>
                      <dd>{warehouse.insuranceCoverage}</dd>
                    </div>
                  )}
                </dl>
                {warehouse.mediaSamples?.length && (
                  <div className="warehouse-card__media">
                    {warehouse.mediaSamples.map((sample) => (
                      <span key={sample}>{sample}</span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="warehouse-card__select"
                  onClick={() => {
                    updateForm({ warehouseId: warehouse.id });
                    goToStep('pricing');
                  }}
                >
                  Use this warehouse
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {step === 'pricing' && (
        <form className="order-form">
          <fieldset>
            <legend>Pricing configuration</legend>
            <label className="order-form__field">
              <span>Order amount (APT)</span>
              <input
                type="number"
                step="0.0001"
                min={ORDER_DEFAULTS.amountMinApt}
                max={ORDER_DEFAULTS.amountMaxApt}
                value={formState.amountApt}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm({ amountApt: event.target.value })}
              />
              {errors.amountApt && <span className="order-create__error">{errors.amountApt}</span>}
            </label>
            <label className="order-form__field">
              <span>Insurance rate (%)</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={ORDER_DEFAULTS.insuranceRateMaxBps / 100}
                value={formState.insuranceRate}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const value = Number.parseFloat(event.target.value);
                  updateForm({ insuranceRate: Number.isFinite(value) ? value : formState.insuranceRate });
                }}
              />
            </label>
            <label className="order-form__field">
              <span>Platform fee (%)</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={5}
                value={formState.platformFeeRate}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const value = Number.parseFloat(event.target.value);
                  updateForm({ platformFeeRate: Number.isFinite(value) ? value : formState.platformFeeRate });
                }}
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>Logistics metadata</legend>
            <label className="order-form__field">
              <span>Carrier</span>
              <input
                type="text"
                value={formState.carrier ?? ''}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm({ carrier: event.target.value })}
                placeholder="SF Express"
              />
            </label>
            <label className="order-form__field">
              <span>Tracking number</span>
              <input
                type="text"
                value={formState.trackingNumber ?? ''}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm({ trackingNumber: event.target.value })}
                placeholder="SF123456789CN"
              />
            </label>
            <label className="order-form__field">
              <span>Media hash (optional)</span>
              <input
                type="text"
                value={formState.mediaHash ?? ''}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateForm({ mediaHash: event.target.value })}
                placeholder={'0'.repeat(64)}
              />
              {errors.mediaHash && <span className="order-create__error">{errors.mediaHash}</span>}
            </label>
            <label className="order-form__field">
              <span>Media category</span>
              <select
                value={formState.mediaCategory}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => updateForm({ mediaCategory: event.target.value })}
                disabled={!formState.mediaHash}
              >
                <option value={ORDER_MEDIA_STAGES.INBOUND}>Inbound proof</option>
                <option value={ORDER_MEDIA_STAGES.STORAGE}>Storage snapshot</option>
                <option value={ORDER_MEDIA_STAGES.OUTBOUND}>Outbound handoff</option>
              </select>
            </label>
            <label className="order-form__field">
              <span>Notes for warehouse (optional)</span>
              <textarea
                rows={3}
                value={formState.notes ?? ''}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateForm({ notes: event.target.value })}
              />
            </label>
          </fieldset>

          <div className="order-form__actions">
            <button type="button" className="order-form__button order-form__button--secondary" onClick={() => goToStep('warehouse')}>
              Back
            </button>
            <button
              type="button"
              className="order-form__button"
              onClick={() => {
                validateStep('pricing');
                setStep('review');
                clearTransientState();
              }}
            >
              Continue to review
            </button>
          </div>
        </form>
      )}

      {step === 'review' && (
        <section className="order-review">
          <div className="order-review__panel">
            <header className="order-review__header">
              <h2>Review order details</h2>
              <p>Confirm warehouse, fee breakdown and logistics info before signing the transaction.</p>
            </header>
            <dl className="order-review__summary">
              <div>
                <dt>Warehouse</dt>
                <dd>{selectedWarehouse?.name ?? 'Not selected'}</dd>
              </div>
              <div>
                <dt>Logistics</dt>
                <dd>{deriveInboundLogistics(formState) ?? 'Not provided'}</dd>
              </div>
            </dl>
            <table className="order-review__table">
              <caption>Fee breakdown</caption>
              <tbody>
                {pricingRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} APT</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {formState.mediaHash && (
              <p className="order-review__hash">
                Media hash ({formState.mediaCategory}): <code>{formState.mediaHash}</code>
              </p>
            )}
          </div>

          <div className="order-review__panel order-review__panel--actions">
            <NetworkGuard>
              <>
                <div className="order-review__actions">
                  <button type="button" className="order-form__button order-form__button--secondary" onClick={() => goToStep('pricing')}>
                    Back to fees
                  </button>
                  <button type="button" className="order-form__button order-form__button--ghost" onClick={simulateOrder}>
                    Estimate gas
                  </button>
                  <button type="button" className="order-form__button" onClick={submitOrder}>
                    Sign & submit
                  </button>
                </div>

                {simulationState.status === 'loading' && <p>Simulating transaction…</p>}
                {simulationState.status === 'error' && <p className="order-create__error">{simulationState.message}</p>}
                {simulationState.status === 'success' && (
                  <div className="order-review__estimates">
                    <h3>Gas estimate</h3>
                    <ul>
                      <li>Gas used: {simulationState.gasUsed}</li>
                      <li>Gas unit price: {simulationState.gasUnitPrice}</li>
                      <li>Estimated fee: {simulationState.estimatedFee.toFixed(6)} APT</li>
                    </ul>
                  </div>
                )}

                {transactionState.stage !== 'idle' && (
                  <div className={`order-review__status order-review__status--${transactionState.stage}`}>
                    {transactionState.stage === 'submitting' && <p>Waiting for wallet signature…</p>}
                    {transactionState.stage === 'pending' && (
                      <p>
                        Transaction submitted.{' '}
                        {transactionState.hash ? (
                          <a href={transactionState.explorerUrl} target="_blank" rel="noreferrer">
                            {transactionState.hash}
                          </a>
                        ) : null}
                      </p>
                    )}
                    {transactionState.stage === 'failed' && <p className="order-create__error">{transactionState.error}</p>}
                    {transactionState.stage === 'success' && transactionState.hash && (
                      <p>
                        Order confirmed on-chain.
                        {resolvedRecordUid ? (
                          <span>
                            {' '}Record UID: <code>{resolvedRecordUid}</code>.
                          </span>
                        ) : null}{' '}
                        <a href={transactionState.explorerUrl} target="_blank" rel="noreferrer">
                          View on explorer
                        </a>
                      </p>
                    )}
                  </div>
                )}
              </>
            </NetworkGuard>
          </div>

          {(orderDetail || optimisticOrder) && (
            <div className="order-review__panel">
              <h3>Order timeline</h3>
              <ul className="order-timeline">
                {orderDetail?.timeline?.map((item) => (
                  <li key={`${item.stage}-${item.occurredAt}`}>
                    <span className="order-timeline__timestamp">{new Date(item.occurredAt).toLocaleString()}</span>
                    <span className="order-timeline__label">{ORDER_STATUS_LABELS[item.stage] ?? item.label}</span>
                    {item.details && <p>{item.details}</p>}
                  </li>
                ))}
                {!orderDetail?.timeline?.length && optimisticOrder && (
                  <li>
                    <span className="order-timeline__timestamp">
                      {new Date(optimisticOrder.createdAt).toLocaleString()}
                    </span>
                    <span className="order-timeline__label">Order submitted</span>
                    <p>Waiting for indexer to ingest events. Hash {optimisticOrder.transactionHash}</p>
                  </li>
                )}
              </ul>
              {orderList.length > 0 && (
                <p className="order-review__hint">
                  {`Total merchant orders tracked: ${orderList.length}. Latest status ${ORDER_STATUS_LABELS[orderDetail?.status ?? 'CREATED'] ?? orderDetail?.status ?? 'Pending timeline update'}.`}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
