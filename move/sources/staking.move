module haigo::staking {
    use std::error;
    use std::signer;
    use std::table::{Self, Table};

    const E_INSUFFICIENT_CREDIT: u64 = 1;

    struct CreditBook has key {
        credits: Table<address, u64>,
    }

    public fun assert_min_credit(addr: address, required: u64) acquires CreditBook {
        if (!exists<CreditBook>(@haigo)) {
            return;
        };

        let book = borrow_global<CreditBook>(@haigo);
        if (!table::contains(&book.credits, addr)) {
            assert!(required == 0, error::invalid_state(E_INSUFFICIENT_CREDIT));
            return;
        };
        let credit = *table::borrow(&book.credits, addr);
        assert!(credit >= required, error::invalid_state(E_INSUFFICIENT_CREDIT));
    }

    #[test_only]
    public fun init_for_test(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        if (!exists<CreditBook>(@haigo)) {
            assert!(admin_addr == @haigo, error::permission_denied(E_INSUFFICIENT_CREDIT));
            move_to(admin, CreditBook { credits: table::new() });
        }
    }

    #[test_only]
    public fun set_credit(admin: &signer, addr: address, credit: u64) acquires CreditBook {
        assert!(signer::address_of(admin) == @haigo, error::permission_denied(E_INSUFFICIENT_CREDIT));
        if (!exists<CreditBook>(@haigo)) {
            move_to(admin, CreditBook { credits: table::new() });
        };
        let book = borrow_global_mut<CreditBook>(@haigo);
        if (table::contains(&book.credits, addr)) {
            let _ = table::remove(&mut book.credits, addr);
        };
        if (credit > 0) {
            table::add(&mut book.credits, addr, credit);
        }
    }
}
