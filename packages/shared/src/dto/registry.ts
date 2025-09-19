/**
 * Registry DTOs for account registration events and records
 * These match the Move module event structures for consistent data flow
 */

export interface AccountRecord {
  address: string;
  role: number; // ROLE_SELLER = 1, ROLE_WAREHOUSE = 2
  hashAlgorithm: number; // HASH_ALGORITHM_BLAKE3 = 1
  hashValue: string; // 64-character lowercase hex string
  timestamp: number; // Unix timestamp in seconds
}

export interface SellerRegisteredEvent {
  address: string;
  role: number; // Always ROLE_SELLER = 1
  hashAlgorithm: number; // HASH_ALGORITHM_BLAKE3 = 1
  hashValue: string; // 64-character lowercase hex BLAKE3 hash
  timestamp: number; // Unix timestamp in seconds
  sequence: number; // Event sequence number
}

export interface WarehouseRegisteredEvent {
  address: string;
  role: number; // Always ROLE_WAREHOUSE = 2
  hashAlgorithm: number; // HASH_ALGORITHM_BLAKE3 = 1
  hashValue: string; // 64-character lowercase hex BLAKE3 hash
  timestamp: number; // Unix timestamp in seconds
  sequence: number; // Event sequence number
}

// Union type for all registry events
export type RegistryEvent = SellerRegisteredEvent | WarehouseRegisteredEvent;

// API response format for /api/accounts/:address endpoint
export interface AccountResponse {
  address: string;
  role: 'seller' | 'warehouse';
  profileHash: {
    algorithm: 'blake3';
    value: string; // 64-character lowercase hex
  };
  registeredAt: string; // ISO 8601 timestamp
  profileUri?: string;
  orderCount?: number;
  isVerified?: boolean;
}

// Transitional shape returned by older services (uses `algo` key)
export interface LegacyAccountResponse {
  address: string;
  role: 'seller' | 'warehouse';
  profileHash: {
    algo?: 'blake3';
    algorithm?: 'blake3';
    value: string;
  };
  registeredAt: string;
  profileUri?: string | null;
  orderCount?: number | null;
  isVerified?: boolean;
}

// Unified profile representation consumed across frontends
export interface AccountProfile {
  address: string;
  role: 'seller' | 'warehouse';
  profileHash: {
    algorithm: 'blake3';
    value: string;
  };
  profileUri?: string;
  registeredAt: string;
  orderCount?: number;
  isVerified?: boolean;
}

export const normalizeAccountResponse = (
  payload: AccountResponse | LegacyAccountResponse | null | undefined
): AccountProfile | null => {
  if (!payload) {
    return null;
  }

  const algorithm = payload.profileHash.algorithm ?? payload.profileHash.algo ?? 'blake3';

  return {
    address: payload.address.toLowerCase(),
    role: payload.role,
    profileHash: {
      algorithm,
      value: payload.profileHash.value.toLowerCase()
    },
    profileUri: payload.profileUri ?? undefined,
    registeredAt: payload.registeredAt,
    orderCount: payload.orderCount ?? undefined,
    isVerified: payload.isVerified
  };
};

// Registration request format for frontend/API
export interface RegisterAccountRequest {
  role: 'seller' | 'warehouse';
  profileHash: string; // 64-character lowercase hex BLAKE3 hash
}

// Helper type guards
export const isSellerEvent = (event: RegistryEvent): event is SellerRegisteredEvent =>
  event.role === 1;

export const isWarehouseEvent = (event: RegistryEvent): event is WarehouseRegisteredEvent =>
  event.role === 2;
