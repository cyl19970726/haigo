/**
 * Registry DTOs for account registration events and records
 * These match the Move module event structures for consistent data flow
 */
// Helper type guards
export const isSellerEvent = (event) => event.role === 1;
export const isWarehouseEvent = (event) => event.role === 2;
