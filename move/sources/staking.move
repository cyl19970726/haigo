module haigo::staking {
    use std::error;
    use std::signer;
    use std::table::{Self, Table};
    use std::string::{Self, String};
    use aptos_framework::account;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::timestamp;
    use haigo::registry;

    // Errors
    const E_INSUFFICIENT_CREDIT: u64 = 1;
    const E_UNAUTHORIZED_ROLE: u64 = 2;
    const E_INVALID_AMOUNT: u64 = 3;
    const E_INVALID_FEE: u64 = 4;
    const E_NOT_INITIALIZED: u64 = 5;

    // Credit book used by other modules (e.g., orders) for seller credit guard
    struct CreditBook has key {
        credits: Table<address, u64>,
    }

    // Staking state for warehouses + storage fee
    struct StakingBook has key {
        positions: Table<address, u64>,
        fees: Table<address, u64>,
        stake_changed_events: EventHandle<StakeChanged>,
        fee_updated_events: EventHandle<StorageFeeUpdated>,
    }

    // Events
    struct StakeChanged has store, drop {
        warehouse: address,
        delta: u64,
        new_amount: u64,
        timestamp: u64,
    }

    struct StorageFeeUpdated has store, drop {
        warehouse: address,
        fee_per_unit: u64,
        timestamp: u64,
    }

    // Views
    #[view]
    public fun get_stake(addr: address): u64 acquires StakingBook {
        if (!exists<StakingBook>(@haigo)) { return 0 };
        let book = borrow_global<StakingBook>(@haigo);
        if (!table::contains(&book.positions, addr)) { return 0 };
        *table::borrow(&book.positions, addr)
    }

    #[view]
    public fun get_storage_fee(addr: address): u64 acquires StakingBook {
        if (!exists<StakingBook>(@haigo)) { return 0 };
        let book = borrow_global<StakingBook>(@haigo);
        if (!table::contains(&book.fees, addr)) { return 0 };
        *table::borrow(&book.fees, addr)
    }

    // Credit guard for orders etc.
    public fun assert_min_credit(addr: address, required: u64) acquires CreditBook {
        if (!exists<CreditBook>(@haigo)) { return; };
        let book = borrow_global<CreditBook>(@haigo);
        if (!table::contains(&book.credits, addr)) {
            assert!(required == 0, error::invalid_state(E_INSUFFICIENT_CREDIT));
            return;
        };
        let credit = *table::borrow(&book.credits, addr);
        assert!(credit >= required, error::invalid_state(E_INSUFFICIENT_CREDIT));
    }

    // Initialize staking state (idempotent)
    public entry fun init_staking_entry(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @haigo, error::permission_denied(E_UNAUTHORIZED_ROLE));
        if (!exists<StakingBook>(@haigo)) {
            move_to(admin, StakingBook {
                positions: table::new(),
                fees: table::new(),
                stake_changed_events: account::new_event_handle<StakeChanged>(admin),
                fee_updated_events: account::new_event_handle<StorageFeeUpdated>(admin),
            });
        }
        if (!exists<CreditBook>(@haigo)) {
            move_to(admin, CreditBook { credits: table::new() });
        }
    }

    // Warehouse stakes amount (PoC: only records accounting; no coin locking)
    public entry fun stake<CoinType>(warehouse: &signer, amount: u64) acquires StakingBook {
        assert!(amount > 0, error::invalid_argument(E_INVALID_AMOUNT));
        let addr = signer::address_of(warehouse);
        registry::assert_role(addr, registry::role_warehouse());
        assert!(exists<StakingBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<StakingBook>(@haigo);
        let prev = if (table::contains(&book.positions, addr)) { *table::borrow(&book.positions, addr) } else { 0 };
        let new_amount = prev + amount;
        if (table::contains(&book.positions, addr)) {
            let _ = table::remove(&mut book.positions, addr);
        };
        table::add(&mut book.positions, addr, new_amount);
        // emit event
        event::emit_event<StakeChanged>(&mut book.stake_changed_events, StakeChanged { warehouse: addr, delta: amount, new_amount, timestamp: timestamp::now_seconds() });
    }

    // Warehouse unstakes amount (bounded by current position)
    public entry fun unstake<CoinType>(warehouse: &signer, amount: u64) acquires StakingBook {
        assert!(amount > 0, error::invalid_argument(E_INVALID_AMOUNT));
        let addr = signer::address_of(warehouse);
        registry::assert_role(addr, registry::role_warehouse());
        assert!(exists<StakingBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<StakingBook>(@haigo);
        let prev = if (table::contains(&book.positions, addr)) { *table::borrow(&book.positions, addr) } else { 0 };
        assert!(prev >= amount, error::invalid_argument(E_INVALID_AMOUNT));
        let new_amount = prev - amount;
        let _ = if (table::contains(&book.positions, addr)) { table::remove(&mut book.positions, addr) } else { 0 };
        if (new_amount > 0) { table::add(&mut book.positions, addr, new_amount); };
        event::emit_event<StakeChanged>(&mut book.stake_changed_events, StakeChanged { warehouse: addr, delta: 0 - 0 + amount /* keep delta as amount (unstake implies negative in client) */, new_amount, timestamp: timestamp::now_seconds() });
    }

    // Set storage fee (bps or minimal unit). Guarded to warehouses only.
    public entry fun set_storage_fee(warehouse: &signer, fee_per_unit: u64) acquires StakingBook {
        let addr = signer::address_of(warehouse);
        registry::assert_role(addr, registry::role_warehouse());
        // basic sanity: 0..=10000 bps (allowed up to 100%)
        assert!(fee_per_unit <= 10000, error::invalid_argument(E_INVALID_FEE));
        assert!(exists<StakingBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<StakingBook>(@haigo);
        if (table::contains(&book.fees, addr)) { let _ = table::remove(&mut book.fees, addr); };
        table::add(&mut book.fees, addr, fee_per_unit);
        event::emit_event<StorageFeeUpdated>(&mut book.fee_updated_events, StorageFeeUpdated { warehouse: addr, fee_per_unit, timestamp: timestamp::now_seconds() });
    }

    // -------- Test helpers --------
    #[test_only]
    public fun init_for_test(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        if (!exists<CreditBook>(@haigo)) {
            assert!(admin_addr == @haigo, error::permission_denied(E_INSUFFICIENT_CREDIT));
            move_to(admin, CreditBook { credits: table::new() });
        };
        if (!exists<StakingBook>(@haigo)) {
            move_to(admin, StakingBook {
                positions: table::new(),
                fees: table::new(),
                stake_changed_events: account::new_event_handle<StakeChanged>(admin),
                fee_updated_events: account::new_event_handle<StorageFeeUpdated>(admin),
            });
        }
    }

    #[test_only]
    public fun set_credit(admin: &signer, addr: address, credit: u64) acquires CreditBook {
        assert!(signer::address_of(admin) == @haigo, error::permission_denied(E_INSUFFICIENT_CREDIT));
        if (!exists<CreditBook>(@haigo)) { move_to(admin, CreditBook { credits: table::new() }); };
        let book = borrow_global_mut<CreditBook>(@haigo);
        if (table::contains(&book.credits, addr)) { let _ = table::remove(&mut book.credits, addr); };
        if (credit > 0) { table::add(&mut book.credits, addr, credit); }
    }

    #[test(aptos_framework = @0x1, admin = @haigo)]
    public fun test_stake_and_fee_flow(aptos_framework: &signer, admin: &signer) acquires StakingBook {
        use aptos_framework::timestamp;
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);

        // prepare registry & staking
        haigo::registry::init_for_test(admin);
        init_for_test(admin);

        // create a warehouse account and register
        let w_addr = @0x100;
        let w_signer = account::create_account_for_test(w_addr);
        haigo::registry::register_warehouse(&w_signer, haigo::registry::hash_algorithm_blake3(), string::utf8(b"0000000000000000000000000000000000000000000000000000000000000000"));

        stake<u64>(&w_signer, 100);
        assert!(get_stake(w_addr) == 100, 1);

        set_storage_fee(&w_signer, 25);
        assert!(get_storage_fee(w_addr) == 25, 2);

        unstake<u64>(&w_signer, 40);
        assert!(get_stake(w_addr) == 60, 3);
    }

    #[test(aptos_framework = @0x1, admin = @haigo)]
    #[expected_failure(abort_code = 0x10003, location = Self)]
    public fun test_unstake_invalid_amount(aptos_framework: &signer, admin: &signer) acquires StakingBook {
        use aptos_framework::timestamp;
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(@haigo);
        haigo::registry::init_for_test(admin);
        init_for_test(admin);
        let w_addr = @0x101;
        let w_signer = account::create_account_for_test(w_addr);
        haigo::registry::register_warehouse(&w_signer, haigo::registry::hash_algorithm_blake3(), string::utf8(b"0000000000000000000000000000000000000000000000000000000000000000"));
        // Unstake without stake should fail
        unstake<u64>(&w_signer, 10);
    }
}
