module haigo::registry {
    use std::signer;
    use std::error;
    use std::string::{Self, String};
    use std::table::{Self, Table};
    use aptos_framework::account;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::timestamp;

    // Error codes
    const E_ALREADY_REGISTERED: u64 = 1;
    const E_INVALID_HASH_LENGTH: u64 = 2;
    const E_INVALID_HASH_FORMAT: u64 = 3;
    const E_INVALID_ALGORITHM: u64 = 4;
    const E_ROLE_MISMATCH: u64 = 5;
    const E_UNAUTHORIZED: u64 = 6;

    // Role flags
    const ROLE_SELLER: u8 = 1;
    const ROLE_WAREHOUSE: u8 = 2;
    const ROLE_PLATFORM_OPERATOR: u8 = 4;

    // Hash algorithm constants
    const HASH_ALGORITHM_BLAKE3: u8 = 1;

    // Account record storing address, role flag, and profile hash metadata
    struct AccountRecord has store, copy, drop {
        address: address,
        role: u8,
        hash_algorithm: u8,
        hash_value: String,
        timestamp: u64,
    }

    // Registry resource to guard global registry state
    struct Registry has key {
        // Table mapping address to their registration record
        accounts: Table<address, AccountRecord>,
        // Event handles for registration events
        seller_registered_events: EventHandle<SellerRegistered>,
        warehouse_registered_events: EventHandle<WarehouseRegistered>,
        platform_registered_events: EventHandle<PlatformOperatorRegistered>,
    }

    // Event emitted when a seller registers
    struct SellerRegistered has store, drop {
        address: address,
        role: u8,
        hash_algorithm: u8,
        hash_value: String,
        timestamp: u64,
        sequence: u64,
    }

    // Event emitted when a warehouse registers
    struct WarehouseRegistered has store, drop {
        address: address,
        role: u8,
        hash_algorithm: u8,
        hash_value: String,
        timestamp: u64,
        sequence: u64,
    }

    // Event emitted when a platform operator registers
    struct PlatformOperatorRegistered has store, drop {
        address: address,
        role: u8,
        hash_algorithm: u8,
        hash_value: String,
        timestamp: u64,
        sequence: u64,
    }

    // Initialize the registry resource (called once during deployment)
    fun init_module(account: &signer) {
        move_to(account, Registry {
            accounts: table::new(),
            seller_registered_events: account::new_event_handle<SellerRegistered>(account),
            warehouse_registered_events: account::new_event_handle<WarehouseRegistered>(account),
            platform_registered_events: account::new_event_handle<PlatformOperatorRegistered>(account),
        });
    }

    // Public entry wrapper for initialization（幂等）
    // 仅允许 @haigo 账户调用；若已初始化则无操作。
    public entry fun init_registry_entry(account: &signer) {
        let addr = signer::address_of(account);
        assert!(addr == @haigo, error::permission_denied(E_UNAUTHORIZED));
        if (!exists<Registry>(@haigo)) {
            init_module(account);
        };
    }

    // Validate hash format - must be 64 character lowercase hex string for BLAKE3
    fun validate_hash(hash_algorithm: u8, hash_value: &String): bool {
        // Only support BLAKE3 for now
        if (hash_algorithm != HASH_ALGORITHM_BLAKE3) {
            return false
        };

        let hash_bytes = string::bytes(hash_value);
        let length = std::vector::length(hash_bytes);

        // BLAKE3 produces 256-bit (32 byte) hash, encoded as 64 hex characters
        if (length != 64) {
            return false
        };

        // Verify all characters are lowercase hex [0-9a-f]
        let i = 0;
        while (i < length) {
            let char = *std::vector::borrow(hash_bytes, i);
            if (!((char >= 48 && char <= 57) || (char >= 97 && char <= 102))) { // 0-9 or a-f
                return false
            };
            i = i + 1;
        };

        true
    }

    // Register a seller with profile hash
    public entry fun register_seller(
        account: &signer,
        hash_algorithm: u8,
        hash_value: String
    ) acquires Registry {
        let account_addr = signer::address_of(account);

        // Validate hash format
        assert!(validate_hash(hash_algorithm, &hash_value), error::invalid_argument(E_INVALID_HASH_FORMAT));

        let registry = borrow_global_mut<Registry>(@haigo);

        // Check if already registered
        assert!(!table::contains(&registry.accounts, account_addr), error::already_exists(E_ALREADY_REGISTERED));

        let current_time = timestamp::now_seconds();

        // Create account record
        let record = AccountRecord {
            address: account_addr,
            role: ROLE_SELLER,
            hash_algorithm,
            hash_value: hash_value,
            timestamp: current_time,
        };

        // Store the record
        table::add(&mut registry.accounts, account_addr, record);

        // Emit event
        let event = SellerRegistered {
            address: account_addr,
            role: ROLE_SELLER,
            hash_algorithm,
            hash_value: hash_value,
            timestamp: current_time,
            sequence: event::counter(&registry.seller_registered_events),
        };

        event::emit_event(&mut registry.seller_registered_events, event);
    }

    // Register a warehouse with profile hash
    public entry fun register_warehouse(
        account: &signer,
        hash_algorithm: u8,
        hash_value: String
    ) acquires Registry {
        let account_addr = signer::address_of(account);

        // Validate hash format
        assert!(validate_hash(hash_algorithm, &hash_value), error::invalid_argument(E_INVALID_HASH_FORMAT));

        let registry = borrow_global_mut<Registry>(@haigo);

        // Check if already registered
        assert!(!table::contains(&registry.accounts, account_addr), error::already_exists(E_ALREADY_REGISTERED));

        let current_time = timestamp::now_seconds();

        // Create account record
        let record = AccountRecord {
            address: account_addr,
            role: ROLE_WAREHOUSE,
            hash_algorithm,
            hash_value: hash_value,
            timestamp: current_time,
        };

        // Store the record
        table::add(&mut registry.accounts, account_addr, record);

        // Emit event
        let event = WarehouseRegistered {
            address: account_addr,
            role: ROLE_WAREHOUSE,
            hash_algorithm,
            hash_value: hash_value,
            timestamp: current_time,
            sequence: event::counter(&registry.warehouse_registered_events),
        };

        event::emit_event(&mut registry.warehouse_registered_events, event);
    }

    // Register a platform operator or delegated platform account
    public entry fun register_platform_operator(
        account: &signer,
        hash_algorithm: u8,
        hash_value: String
    ) acquires Registry {
        let account_addr = signer::address_of(account);

        assert!(validate_hash(hash_algorithm, &hash_value), error::invalid_argument(E_INVALID_HASH_FORMAT));

        let registry = borrow_global_mut<Registry>(@haigo);

        assert!(!table::contains(&registry.accounts, account_addr), error::already_exists(E_ALREADY_REGISTERED));

        let current_time = timestamp::now_seconds();

        let record = AccountRecord {
            address: account_addr,
            role: ROLE_PLATFORM_OPERATOR,
            hash_algorithm,
            hash_value: hash_value,
            timestamp: current_time,
        };

        table::add(&mut registry.accounts, account_addr, record);

        let event = PlatformOperatorRegistered {
            address: account_addr,
            role: ROLE_PLATFORM_OPERATOR,
            hash_algorithm,
            hash_value: hash_value,
            timestamp: current_time,
            sequence: event::counter(&registry.platform_registered_events),
        };

        event::emit_event(&mut registry.platform_registered_events, event);
    }

    // Check if an address is registered
    #[view]
    public fun is_registered(addr: address): bool acquires Registry {
        let registry = borrow_global<Registry>(@haigo);
        table::contains(&registry.accounts, addr)
    }

    // Get account record for an address
    #[view]
    public fun get_account_record(addr: address): AccountRecord acquires Registry {
        let registry = borrow_global<Registry>(@haigo);
        *table::borrow(&registry.accounts, addr)
    }

    // Assert a specific role for an address, aborting if not matched
    public fun assert_role(addr: address, expected_role: u8) acquires Registry {
        let registry = borrow_global<Registry>(@haigo);
        assert!(table::contains(&registry.accounts, addr), error::permission_denied(E_ROLE_MISMATCH));
        let record = table::borrow(&registry.accounts, addr);
        assert!(record.role == expected_role, error::permission_denied(E_ROLE_MISMATCH));
    }

    public fun role_seller(): u8 {
        ROLE_SELLER
    }

    public fun role_warehouse(): u8 {
        ROLE_WAREHOUSE
    }

    public fun role_platform_operator(): u8 {
        ROLE_PLATFORM_OPERATOR
    }

    public fun hash_algorithm_blake3(): u8 {
        HASH_ALGORITHM_BLAKE3
    }


    #[test_only]
    public fun init_for_test(account: &signer) {
        init_module(account);
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    public fun test_register_seller_success(aptos_framework: &signer, account: &signer) acquires Registry {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);

        init_for_test(account);

        let test_addr = @0x123;
        let test_account = account::create_account_for_test(test_addr);

        register_seller(&test_account, HASH_ALGORITHM_BLAKE3, string::utf8(b"a1b2c3d4e5f67890123456789012345678901234567890123456789012345678"));

        assert!(is_registered(test_addr), 1);

        let record = get_account_record(test_addr);
        assert!(record.role == ROLE_SELLER, 2);
        assert!(record.hash_algorithm == HASH_ALGORITHM_BLAKE3, 3);
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    public fun test_register_warehouse_success(aptos_framework: &signer, account: &signer) acquires Registry {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);

        init_for_test(account);

        let test_addr = @0x456;
        let test_account = account::create_account_for_test(test_addr);

        register_warehouse(&test_account, HASH_ALGORITHM_BLAKE3, string::utf8(b"b1c2d3e4f5a67890123456789012345678901234567890123456789012345678"));

        assert!(is_registered(test_addr), 1);

        let record = get_account_record(test_addr);
        assert!(record.role == ROLE_WAREHOUSE, 2);
        assert!(record.hash_algorithm == HASH_ALGORITHM_BLAKE3, 3);
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    #[expected_failure(abort_code = 0x80001, location = Self)]
    public fun test_duplicate_registration_fails(aptos_framework: &signer, account: &signer) acquires Registry {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);

        init_for_test(account);

        let test_addr = @0x789;
        let test_account = account::create_account_for_test(test_addr);

        // First registration should succeed
        register_seller(&test_account, HASH_ALGORITHM_BLAKE3, string::utf8(b"c1d2e3f4a5b67890123456789012345678901234567890123456789012345678"));

        // Second registration should fail
        register_seller(&test_account, HASH_ALGORITHM_BLAKE3, string::utf8(b"d1e2f3a4b5c67890123456789012345678901234567890123456789012345678"));
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    #[expected_failure(abort_code = 0x10003, location = Self)]
    public fun test_invalid_hash_length_fails(aptos_framework: &signer, account: &signer) acquires Registry {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);

        init_for_test(account);

        let test_addr = @0xabc;
        let test_account = account::create_account_for_test(test_addr);

        // Hash too short (should be 64 chars)
        register_seller(&test_account, HASH_ALGORITHM_BLAKE3, string::utf8(b"short"));
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    #[expected_failure(abort_code = 0x10003, location = Self)]
    public fun test_invalid_hash_format_fails(aptos_framework: &signer, account: &signer) acquires Registry {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);

        init_for_test(account);

        let test_addr = @0xdef;
        let test_account = account::create_account_for_test(test_addr);

        // Hash contains invalid characters (uppercase G)
        register_seller(&test_account, HASH_ALGORITHM_BLAKE3, string::utf8(b"G1h2i3j4k5l67890123456789012345678901234567890123456789012345678"));
    }
}
