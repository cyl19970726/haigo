export type WarehouseAvailability = 'available' | 'limited' | 'maintenance';

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

export interface OrderTimelineItemDto {
  stage: 'CREATED' | 'WAREHOUSE_IN' | 'IN_STORAGE' | 'WAREHOUSE_OUT' | 'NOTE';
  label: string;
  occurredAt: string;
  details?: string;
  mediaHashes?: string[];
}

export interface OrderDetailDto extends OrderSummaryDto {
  timeline: OrderTimelineItemDto[];
  media?: Array<{
    stage: string;
    hash: string;
    category?: string;
  }>;
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
