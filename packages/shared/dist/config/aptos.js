/**
 * Aptos Network Configuration
 * Contains module addresses and network settings for different environments
 */
// Development configuration (using dev addresses from Move.toml)
export const APTOS_CONFIG_DEV = {
    network: 'devnet',
    nodeUrl: 'https://fullnode.devnet.aptoslabs.com/v1',
    faucetUrl: 'https://faucet.devnet.aptoslabs.com',
    modules: {
        // This will be the dev address until actual deployment
        registry: '0xA11CE',
        orders: '0xA11CE',
    },
};
// Testnet configuration (to be updated after deployment)
export const APTOS_CONFIG_TESTNET = {
    network: 'testnet',
    nodeUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
    faucetUrl: 'https://faucet.testnet.aptoslabs.com',
    modules: {
        // TODO: Update with actual deployed module address after running deploy_registry.sh
        registry: process.env.NEXT_PUBLIC_APTOS_MODULE ?? 'TBD_AFTER_DEPLOYMENT',
        orders: process.env.NEXT_PUBLIC_APTOS_ORDERS_MODULE ?? 'TBD_AFTER_DEPLOYMENT',
    },
};
// Mainnet configuration (for future use)
export const APTOS_CONFIG_MAINNET = {
    network: 'mainnet',
    nodeUrl: 'https://fullnode.mainnet.aptoslabs.com/v1',
    modules: {
        // TODO: Update with mainnet deployment address
        registry: 'TBD_AFTER_MAINNET_DEPLOYMENT',
        orders: 'TBD_AFTER_MAINNET_DEPLOYMENT',
    },
};
// Export the configuration based on environment
export const getAptosConfig = () => {
    // Prefer frontend-exposed network when present
    const env = (process.env.NEXT_PUBLIC_APTOS_NETWORK || process.env.APTOS_NETWORK || process.env.NODE_ENV || 'development').toLowerCase();
    switch (env) {
        case 'mainnet':
        case 'production':
            return APTOS_CONFIG_MAINNET;
        case 'testnet':
        case 'test':
            return APTOS_CONFIG_TESTNET;
        case 'devnet':
        case 'development':
        default:
            return APTOS_CONFIG_DEV;
    }
};
// Registry module constants
export const REGISTRY_MODULE = {
    ROLE_SELLER: 1,
    ROLE_WAREHOUSE: 2,
    HASH_ALGORITHM_BLAKE3: 1,
};
export const ORDERS_MODULE_NAME = 'orders';
export const ORDER_EVENT_TYPES = {
    ORDER_CREATED: 'OrderCreated',
    CHECKED_IN: 'CheckedIn',
    SET_IN_STORAGE: 'SetInStorage',
    CHECKED_OUT: 'CheckedOut'
};
// Event type names for indexing
export const EVENT_TYPES = {
    SELLER_REGISTERED: 'SellerRegistered',
    WAREHOUSE_REGISTERED: 'WarehouseRegistered',
};
// Legacy exports for backward compatibility
export const APTOS_MODULE_ADDRESS = getAptosConfig().modules.registry;
export const ORDERS_MODULE_ADDRESS = getAptosConfig().modules.orders;
export const NETWORK_NAME = getAptosConfig().network;
export const APTOS_COIN_TYPE = '0x1::aptos_coin::AptosCoin';
