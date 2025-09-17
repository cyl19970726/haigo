module haigo::placeholder {
    use std::signer;

    /// A stub function to confirm the Move package compiles.
    public fun say_hello(account: &signer) {
        let _addr = signer::address_of(account);
    }
}
