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

export const ORDER_MEDIA_HASH_ALGORITHMS = {
  BLAKE3: 'BLAKE3',
  KECCAK256: 'KECCAK256'
} as const;

export const ORDER_MEDIA_CATEGORIES = {
  INBOUND_PHOTO: 'inbound_photo',
  INBOUND_VIDEO: 'inbound_video',
  INBOUND_DOCUMENT: 'inbound_document'
} as const;

export const ORDER_MEDIA_VERIFICATION_STATUSES = {
  PENDING: 'pending',
  VERIFYING: 'verifying',
  VERIFIED: 'verified',
  FAILED: 'failed',
  RECHECKING: 'rechecking'
} as const;

export const ORDER_MEDIA_ACCEPTED_MIME = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  VIDEO: ['video/mp4', 'video/quicktime'],
  DOCUMENT: ['application/pdf']
} as const;

export const ORDER_MEDIA_MAX_SIZE_BYTES = {
  IMAGE: 15 * 1024 * 1024,
  VIDEO: 200 * 1024 * 1024,
  DOCUMENT: 10 * 1024 * 1024
} as const;

export const ORDER_MEDIA_ERROR_CODES = {
  MIME_NOT_ALLOWED: 'MEDIA_MIME_NOT_ALLOWED',
  SIZE_EXCEEDED: 'MEDIA_SIZE_EXCEEDED',
  HASH_MISMATCH: 'MEDIA_HASH_MISMATCH',
  UPLOAD_FAILED: 'MEDIA_UPLOAD_FAILED'
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Awaiting inbound scan',
  WAREHOUSE_IN: 'Checked in at warehouse',
  IN_STORAGE: 'In cold storage',
  WAREHOUSE_OUT: 'Dispatch in progress'
};

export type OrderStatusKey = keyof typeof ORDER_STATUS_LABELS;
