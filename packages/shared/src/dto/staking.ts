export interface StakeChangedEventDto {
  warehouse: string;
  delta: number;
  newAmount: number;
  timestamp: string; // ISO
  txnVersion: string;
  eventIndex: number;
  txnHash?: string;
}

export interface StorageFeeUpdatedEventDto {
  warehouse: string;
  feePerUnit: number;
  timestamp: string; // ISO
  txnVersion: string;
  eventIndex: number;
  txnHash?: string;
}

export interface StakingIntentDto {
  warehouseAddress: string;
  stakedAmount: string; // stringified bigint in subunits
  minRequired: string; // stringified bigint
  feePerUnit: number; // bps or minimal unit
}

