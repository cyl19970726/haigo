export const ORDER_DEFAULTS = {
  insuranceRateBps: Number(process.env.NEXT_PUBLIC_DEFAULT_INSURANCE_BPS ?? 250),
  platformFeeBps: Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_BPS ?? 75),
  insuranceRateMinBps: 0,
  insuranceRateMaxBps: 2000,
  amountMinApt: 0.01,
  amountMaxApt: 10000
} as const;

export const ORDER_FORM_CACHE_KEY = 'haigo:orders:create';

export const ORDER_MEDIA_STAGES = {
  CREATED: 'created',
  INBOUND: 'inbound',
  STORAGE: 'storage',
  OUTBOUND: 'outbound'
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Awaiting inbound scan',
  WAREHOUSE_IN: 'Checked in at warehouse',
  IN_STORAGE: 'In cold storage',
  WAREHOUSE_OUT: 'Dispatch in progress'
};

export type OrderStatusKey = keyof typeof ORDER_STATUS_LABELS;
