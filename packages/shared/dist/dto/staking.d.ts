export interface StakeChangedEventDto {
    warehouse: string;
    delta: number;
    newAmount: number;
    timestamp: string;
    txnVersion: string;
    eventIndex: number;
    txnHash?: string;
}
export interface StorageFeeUpdatedEventDto {
    warehouse: string;
    feePerUnit: number;
    timestamp: string;
    txnVersion: string;
    eventIndex: number;
    txnHash?: string;
}
export interface StakingIntentDto {
    warehouseAddress: string;
    stakedAmount: string;
    minRequired: string;
    feePerUnit: number;
}
