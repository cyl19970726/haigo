/**
 * Registry DTOs for account registration events and records
 * These match the Move module event structures for consistent data flow
 */
export interface AccountRecord {
    address: string;
    role: number;
    hashAlgorithm: number;
    hashValue: string;
    timestamp: number;
}
export interface SellerRegisteredEvent {
    address: string;
    role: number;
    hashAlgorithm: number;
    hashValue: string;
    timestamp: number;
    sequence: number;
}
export interface WarehouseRegisteredEvent {
    address: string;
    role: number;
    hashAlgorithm: number;
    hashValue: string;
    timestamp: number;
    sequence: number;
}
export type RegistryEvent = SellerRegisteredEvent | WarehouseRegisteredEvent;
export interface AccountResponse {
    address: string;
    role: 'seller' | 'warehouse';
    profileHash: {
        algorithm: 'blake3';
        value: string;
    };
    registeredAt: string;
    isVerified: boolean;
}
export interface RegisterAccountRequest {
    role: 'seller' | 'warehouse';
    profileHash: string;
}
export declare const isSellerEvent: (event: RegistryEvent) => event is SellerRegisteredEvent;
export declare const isWarehouseEvent: (event: RegistryEvent) => event is WarehouseRegisteredEvent;
