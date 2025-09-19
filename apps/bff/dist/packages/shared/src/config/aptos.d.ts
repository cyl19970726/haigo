/**
 * Aptos Network Configuration
 * Contains module addresses and network settings for different environments
 */
export interface AptosConfig {
    network: string;
    nodeUrl: string;
    faucetUrl?: string;
    modules: {
        registry: string;
        orders: string;
    };
}
export declare const APTOS_CONFIG_DEV: AptosConfig;
export declare const APTOS_CONFIG_TESTNET: AptosConfig;
export declare const APTOS_CONFIG_MAINNET: AptosConfig;
export declare const getAptosConfig: () => AptosConfig;
export declare const REGISTRY_MODULE: {
    readonly ROLE_SELLER: 1;
    readonly ROLE_WAREHOUSE: 2;
    readonly HASH_ALGORITHM_BLAKE3: 1;
};
export declare const ORDERS_MODULE_NAME: "orders";
export declare const ORDER_EVENT_TYPES: {
    readonly ORDER_CREATED: "OrderCreated";
    readonly CHECKED_IN: "CheckedIn";
    readonly SET_IN_STORAGE: "SetInStorage";
    readonly CHECKED_OUT: "CheckedOut";
};
export declare const EVENT_TYPES: {
    readonly SELLER_REGISTERED: "SellerRegistered";
    readonly WAREHOUSE_REGISTERED: "WarehouseRegistered";
};
export declare const APTOS_MODULE_ADDRESS: string;
export declare const ORDERS_MODULE_ADDRESS: string;
export declare const NETWORK_NAME: string;
export declare const APTOS_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
