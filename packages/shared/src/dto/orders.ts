import {
  ORDER_MEDIA_HASH_ALGORITHMS,
  ORDER_MEDIA_STAGES,
  ORDER_MEDIA_VERIFICATION_STATUSES
} from '../config/orders.js';

export type WarehouseAvailability = 'available' | 'limited' | 'maintenance';

export type OrderMediaStage = (typeof ORDER_MEDIA_STAGES)[keyof typeof ORDER_MEDIA_STAGES];
export type OrderMediaHashAlgorithm =
  (typeof ORDER_MEDIA_HASH_ALGORITHMS)[keyof typeof ORDER_MEDIA_HASH_ALGORITHMS];
export type OrderMediaVerificationStatus =
  (typeof ORDER_MEDIA_VERIFICATION_STATUSES)[keyof typeof ORDER_MEDIA_VERIFICATION_STATUSES];

export interface WarehouseSummary {
  id: string;
  address: string;
  name: string;
  stakingScore: number;
  creditCapacity: number;
  insuranceCoverage?: string;
  availability: WarehouseAvailability;
  mediaSamples?: string[];
  serviceAreas?: string[];
  lastAuditAt?: string;
}

export interface LogisticsInfo {
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
}

export interface PricingBreakdown {
  amountSubunits: number;
  insuranceFeeSubunits: number;
  platformFeeSubunits: number;
  totalSubunits: number;
  currency: 'APT';
  precision: number;
}

export interface OrderSummaryDto {
  recordUid: string;
  orderId: number;
  status: 'CREATED' | 'WAREHOUSE_IN' | 'IN_STORAGE' | 'WAREHOUSE_OUT' | 'PENDING';
  warehouseAddress: string;
  pricing: PricingBreakdown;
  logistics?: LogisticsInfo;
  createdAt: string;
  updatedAt?: string;
  transactionHash?: string;
}

export interface OrderMediaAsset {
  id?: string;
  recordUid?: string;
  stage: OrderMediaStage;
  category: string;
  hashValue: string;
  hashAlgorithm: OrderMediaHashAlgorithm;
  crossCheckHashAlgorithm?: OrderMediaHashAlgorithm;
  crossCheckHashValue?: string;
  sizeBytes?: number;
  mimeType?: string;
  storagePath?: string;
  path?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  matchedOffchain?: boolean;
  verificationStatus?: OrderMediaVerificationStatus;
  verificationAttempts?: number;
  lastVerificationAt?: string;
  lastVerificationError?: string;
  hash?: { algo: string; value: string };
}

export interface OrderTimelineItemDto {
  stage: 'CREATED' | 'WAREHOUSE_IN' | 'IN_STORAGE' | 'WAREHOUSE_OUT' | 'NOTE';
  label: string;
  occurredAt: string;
  details?: string;
  mediaHashes?: string[];
  mediaAssets?: OrderMediaAsset[];
  verificationStatus?: OrderMediaVerificationStatus;
}

export interface OrderDetailDto extends OrderSummaryDto {
  timeline: OrderTimelineItemDto[];
  media?: Array<{
    stage: string;
    hash: string;
    category?: string;
  }>;
  mediaAssets?: OrderMediaAsset[];
}

export interface PricingFormValues {
  amountApt: number;
  insuranceRateBps: number;
  platformFeeBps: number;
}

export const OCTA_PER_APT = 100_000_000;

export const calculatePricing = ({
  amountApt,
  insuranceRateBps,
  platformFeeBps
}: PricingFormValues): PricingBreakdown => {
  const amountSubunits = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
  const insuranceFeeSubunits = Math.max(Math.round((amountSubunits * insuranceRateBps) / 10_000), 0);
  const platformFeeSubunits = Math.max(Math.round((amountSubunits * platformFeeBps) / 10_000), 0);
  const totalSubunits = amountSubunits + insuranceFeeSubunits + platformFeeSubunits;

  return {
    amountSubunits,
    insuranceFeeSubunits,
    platformFeeSubunits,
    totalSubunits,
    currency: 'APT',
    precision: OCTA_PER_APT
  };
};

export const formatSubunitsToApt = (value: number, precision = OCTA_PER_APT): number => {
  return value / precision;
};

export const deriveRecordUid = (orderId: number, transactionHash?: string) => {
  if (transactionHash) {
    return `order-${orderId}-${transactionHash.slice(2, 10)}`;
  }
  return `order-${orderId}`;
};
