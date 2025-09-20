module haigo::mock_coin {
    use std::signer;
    use std::string;

    use aptos_framework::coin;

    public struct MockCoin has store, drop {}

    struct CapabilityStore has key {
        mint_cap: coin::MintCapability<MockCoin>,
        burn_cap: coin::BurnCapability<MockCoin>,
        freeze_cap: coin::FreezeCapability<MockCoin>,
    }

    public fun ensure_initialized(admin: &signer) {
        if (!exists<CapabilityStore>(signer::address_of(admin))) {
            let (burn_cap, freeze_cap, mint_cap) = coin::initialize<MockCoin>(
                admin,
                string::utf8(b"Mock Coin"),
                string::utf8(b"MCK"),
                6,
                false,
            );
            move_to(admin, CapabilityStore { mint_cap, burn_cap, freeze_cap });
        }
    }

    public fun register(account: &signer) {
        coin::register<MockCoin>(account);
    }

    public fun mint(admin: &signer, recipient: address, amount: u64) acquires CapabilityStore {
        let store = borrow_global<CapabilityStore>(signer::address_of(admin));
        let coin_minted = coin::mint<MockCoin>(amount, &store.mint_cap);
        coin::deposit(recipient, coin_minted);
    }
}
