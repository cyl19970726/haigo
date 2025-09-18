module haigo::orders {
    use std::error;
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};
    use std::table::{Self, Table};
    use std::vector;

    use aptos_framework::account;
    use aptos_framework::coin;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::timestamp;
    use aptos_framework::type_info::{Self, TypeInfo};

    use haigo::mock_coin;
    use haigo::registry;

    // Error codes for deterministic aborts across lifecycle operations
    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_ROLE_MISMATCH: u64 = 3;
    const E_INVALID_STATUS_TRANSITION: u64 = 4;
    const E_INVALID_MEDIA_HASH: u64 = 5;
    const E_MEDIA_STAGE_MISMATCH: u64 = 6;
    const E_ORDER_NOT_FOUND: u64 = 7;
    const E_INSURANCE_BLOCKED: u64 = 8;
    const E_UNAUTHORIZED: u64 = 9;

    // Status constants encode strict lifecycle ordering
    const ORDER_STATUS_CREATED: u8 = 1;
    const ORDER_STATUS_WAREHOUSE_IN: u8 = 2;
    const ORDER_STATUS_IN_STORAGE: u8 = 3;
    const ORDER_STATUS_WAREHOUSE_OUT: u8 = 4;

    // Media stage markers for attestation validation
    const MEDIA_STAGE_CREATED: u8 = 1;
    const MEDIA_STAGE_INBOUND: u8 = 2;
    const MEDIA_STAGE_STORAGE: u8 = 3;
    const MEDIA_STAGE_OUTBOUND: u8 = 4;

    // Stored media record for each attestation in the lifecycle
    struct MediaRecord has store, copy, drop {
        stage: u8,
        category: String,
        hash: vector<u8>,
        timestamp: u64,
    }

    // Pricing and currency metadata persisted per order
    struct PricingRecord has store, copy, drop {
        amount: u64,
        insurance_fee: u64,
        platform_fee: u64,
        total: u64,
        currency: TypeInfo,
    }

    // Optional flattened timeline entry maintained when enabled
    struct TimelineEntry has store, copy, drop {
        order_id: u64,
        status: u8,
        media_stage: Option<u8>,
        timestamp: u64,
    }

    // Core order resource stored in the order book
    struct Order has store {
        id: u64,
        seller: address,
        warehouse: address,
        status: u8,
        pricing: PricingRecord,
        logistics_inbound: Option<String>,
        logistics_outbound: Option<String>,
        created_at: u64,
        checked_in_at: Option<u64>,
        set_in_storage_at: Option<u64>,
        checked_out_at: Option<u64>,
        media_records: vector<MediaRecord>,
        insurance_blocked: bool,
    }

    // Global order book resource stored under the haigo account
    struct OrderBook has key {
        orders: Table<u64, Order>,
        next_order_id: u64,
        platform_account: address,
        timeline_enabled: bool,
        timeline_events: Option<vector<TimelineEntry>>,
        order_created_events: EventHandle<OrderCreated>,
        checked_in_events: EventHandle<CheckedIn>,
        set_in_storage_events: EventHandle<SetInStorage>,
        checked_out_events: EventHandle<CheckedOut>,
    }

    // Events mirror stored state for indexers and analytics
    struct OrderCreated has store, drop {
        order_id: u64,
        seller: address,
        warehouse: address,
        pricing: PricingRecord,
        logistics_inbound: Option<String>,
        timestamp: u64,
        media: vector<MediaRecord>,
    }

    struct CheckedIn has store, drop {
        order_id: u64,
        warehouse: address,
        logistics_inbound: String,
        timestamp: u64,
        media: MediaRecord,
    }

    struct SetInStorage has store, drop {
        order_id: u64,
        warehouse: address,
        timestamp: u64,
        media: MediaRecord,
    }

    struct CheckedOut has store, drop {
        order_id: u64,
        operator: address,
        logistics_outbound: String,
        timestamp: u64,
        media: MediaRecord,
    }

    // View structs returned to off-chain callers
    struct OrderSummaryView has store, drop {
        id: u64,
        seller: address,
        warehouse: address,
        status: u8,
        created_at: u64,
        checked_in_at: Option<u64>,
        set_in_storage_at: Option<u64>,
        checked_out_at: Option<u64>,
        logistics_inbound: Option<String>,
        logistics_outbound: Option<String>,
    }

    struct MediaRecordView has store, drop {
        stage: u8,
        category: String,
        hash: vector<u8>,
        timestamp: u64,
    }

    // Initialize the order book. Must be called exactly once by @haigo.
    fun init_module(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @haigo, error::permission_denied(E_UNAUTHORIZED));
        assert!(!exists<OrderBook>(@haigo), error::already_exists(E_ALREADY_INITIALIZED));

        move_to(admin, OrderBook {
            orders: table::new(),
            next_order_id: 1,
            platform_account: admin_addr,
            timeline_enabled: false,
            timeline_events: option::none(),
            order_created_events: account::new_event_handle<OrderCreated>(admin),
            checked_in_events: account::new_event_handle<CheckedIn>(admin),
            set_in_storage_events: account::new_event_handle<SetInStorage>(admin),
            checked_out_events: account::new_event_handle<CheckedOut>(admin),
        });
    }

    // Configure platform account and timeline preference post-initialization.
    public entry fun configure(admin: &signer, platform_account: address, timeline_enabled: bool) acquires OrderBook {
        Self::configure_internal(admin, platform_account, timeline_enabled);
    }

    fun configure_internal(admin: &signer, platform_account: address, timeline_enabled: bool) acquires OrderBook {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @haigo, error::permission_denied(E_UNAUTHORIZED));
        assert!(exists<OrderBook>(@haigo), error::not_found(E_NOT_INITIALIZED));

        let book = borrow_global_mut<OrderBook>(@haigo);
        book.platform_account = platform_account;

        if (timeline_enabled) {
            if (option::is_none(&book.timeline_events)) {
                book.timeline_events = option::some(vector::empty<TimelineEntry>());
            };
        } else {
            book.timeline_events = option::none();
        };

        book.timeline_enabled = timeline_enabled;
    }

    // Seller entry point to create an order and fund platform accounts.
    public entry fun create_order<CoinType>(
        seller: &signer,
        warehouse: address,
        inbound_logistics: Option<String>,
        amount: u64,
        insurance_fee: u64,
        platform_fee: u64,
        initial_media_category: Option<String>,
        initial_media_hash: Option<vector<u8>>,
    ) acquires OrderBook {
        assert!(exists<OrderBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<OrderBook>(@haigo);

        let seller_addr = signer::address_of(seller);
        registry::assert_role(seller_addr, registry::role_seller());
        registry::assert_role(warehouse, registry::role_warehouse());

        let total = amount + insurance_fee + platform_fee;
        coin::transfer<CoinType>(seller, book.platform_account, total);

        let now = timestamp::now_seconds();

        let media_records = vector::empty<MediaRecord>();
        if (option::is_some(&initial_media_category)) {
            assert!(option::is_some(&initial_media_hash), error::invalid_argument(E_MEDIA_STAGE_MISMATCH));
            let category_ref = option::borrow(&initial_media_category);
            let hash_ref = option::borrow(&initial_media_hash);
            let record = new_media_record(
                MEDIA_STAGE_CREATED,
                clone_string(category_ref),
                clone_bytes(hash_ref),
                now,
            );
            vector::push_back(&mut media_records, record);
        } else {
            assert!(option::is_none(&initial_media_hash), error::invalid_argument(E_MEDIA_STAGE_MISMATCH));
        };

        let pricing = PricingRecord {
            amount,
            insurance_fee,
            platform_fee,
            total,
            currency: type_info::type_of<CoinType>(),
        };

        let order_id = book.next_order_id;
        book.next_order_id = order_id + 1;

        let order = Order {
            id: order_id,
            seller: seller_addr,
            warehouse,
            status: ORDER_STATUS_CREATED,
            pricing,
            logistics_inbound: clone_option_string(&inbound_logistics),
            logistics_outbound: option::none(),
            created_at: now,
            checked_in_at: option::none(),
            set_in_storage_at: option::none(),
            checked_out_at: option::none(),
            media_records,
            insurance_blocked: false,
        };

        table::add(&mut book.orders, order_id, order);

        emit_order_created(book, order_id);
        record_timeline(book, order_id, ORDER_STATUS_CREATED, option::none(), now);
    }

    // Warehouse signs off inbound check-in, updating media and timestamps.
    public entry fun check_in(
        warehouse_signer: &signer,
        order_id: u64,
        inbound_logistics: String,
        media_category: String,
        media_hash: vector<u8>,
    ) acquires OrderBook {
        assert!(exists<OrderBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<OrderBook>(@haigo);
        let warehouse_addr = signer::address_of(warehouse_signer);
        registry::assert_role(warehouse_addr, registry::role_warehouse());

        let order = borrow_order_mut(&mut book.orders, order_id);
        assert!(order.warehouse == warehouse_addr, error::permission_denied(E_UNAUTHORIZED));
        assert!(order.status == ORDER_STATUS_CREATED, error::invalid_state(E_INVALID_STATUS_TRANSITION));

        let now = timestamp::now_seconds();
        let record = new_media_record(MEDIA_STAGE_INBOUND, media_category, media_hash, now);

        order.status = ORDER_STATUS_WAREHOUSE_IN;
        order.checked_in_at = option::some(now);
        order.logistics_inbound = option::some(clone_string(&inbound_logistics));
        vector::push_back(&mut order.media_records, record);

        emit_checked_in(book, order_id, &inbound_logistics);
        record_timeline(book, order_id, ORDER_STATUS_WAREHOUSE_IN, option::some(MEDIA_STAGE_INBOUND), now);
    }

    // Warehouse records storage placement after inbound handling.
    public entry fun set_in_storage(
        warehouse_signer: &signer,
        order_id: u64,
        media_category: String,
        media_hash: vector<u8>,
    ) acquires OrderBook {
        assert!(exists<OrderBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<OrderBook>(@haigo);
        let warehouse_addr = signer::address_of(warehouse_signer);
        registry::assert_role(warehouse_addr, registry::role_warehouse());

        let order = borrow_order_mut(&mut book.orders, order_id);
        assert!(order.warehouse == warehouse_addr, error::permission_denied(E_UNAUTHORIZED));
        assert!(order.status == ORDER_STATUS_WAREHOUSE_IN, error::invalid_state(E_INVALID_STATUS_TRANSITION));

        let now = timestamp::now_seconds();
        let record = new_media_record(MEDIA_STAGE_STORAGE, media_category, media_hash, now);

        order.status = ORDER_STATUS_IN_STORAGE;
        order.set_in_storage_at = option::some(now);
        vector::push_back(&mut order.media_records, record);

        emit_set_in_storage(book, order_id);
        record_timeline(book, order_id, ORDER_STATUS_IN_STORAGE, option::some(MEDIA_STAGE_STORAGE), now);
    }

    // Final checkout transition executed by warehouse or delegated platform operator.
    public entry fun check_out(
        operator: &signer,
        order_id: u64,
        outbound_logistics: String,
        media_category: String,
        media_hash: vector<u8>,
    ) acquires OrderBook {
        assert!(exists<OrderBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<OrderBook>(@haigo);
        let operator_addr = signer::address_of(operator);

        let order = borrow_order_mut(&mut book.orders, order_id);
        assert!(order.status == ORDER_STATUS_IN_STORAGE, error::invalid_state(E_INVALID_STATUS_TRANSITION));

        let allowed = operator_addr == order.warehouse || operator_addr == book.platform_account;
        assert!(allowed, error::permission_denied(E_UNAUTHORIZED));
        assert!(!order.insurance_blocked, error::invalid_state(E_INSURANCE_BLOCKED));

        if (operator_addr == order.warehouse) {
            registry::assert_role(operator_addr, registry::role_warehouse());
        } else {
            registry::assert_role(operator_addr, registry::role_platform_operator());
        };

        let now = timestamp::now_seconds();
        let record = new_media_record(MEDIA_STAGE_OUTBOUND, media_category, media_hash, now);

        order.status = ORDER_STATUS_WAREHOUSE_OUT;
        order.checked_out_at = option::some(now);
        order.logistics_outbound = option::some(clone_string(&outbound_logistics));
        vector::push_back(&mut order.media_records, record);

        emit_checked_out(book, order_id, operator_addr, &outbound_logistics);
        record_timeline(book, order_id, ORDER_STATUS_WAREHOUSE_OUT, option::some(MEDIA_STAGE_OUTBOUND), now);
    }

    // View entry returning summary data for an order.
    #[view]
    public fun get_order_summary(order_id: u64): OrderSummaryView acquires OrderBook {
        let book = borrow_global<OrderBook>(@haigo);
        let order = table::borrow(&book.orders, order_id);

        OrderSummaryView {
            id: order.id,
            seller: order.seller,
            warehouse: order.warehouse,
            status: order.status,
            created_at: order.created_at,
            checked_in_at: clone_option_u64(&order.checked_in_at),
            set_in_storage_at: clone_option_u64(&order.set_in_storage_at),
            checked_out_at: clone_option_u64(&order.checked_out_at),
            logistics_inbound: clone_option_string(&order.logistics_inbound),
            logistics_outbound: clone_option_string(&order.logistics_outbound),
        }
    }

    // View entry returning pricing metadata for an order.
    #[view]
    public fun get_pricing(order_id: u64): PricingRecord acquires OrderBook {
        let book = borrow_global<OrderBook>(@haigo);
        let order = table::borrow(&book.orders, order_id);
        order.pricing
    }

    // View entry returning media attestations for an order.
    #[view]
    public fun get_media(order_id: u64): vector<MediaRecordView> acquires OrderBook {
        let book = borrow_global<OrderBook>(@haigo);
        let order = table::borrow(&book.orders, order_id);

        let views = vector::empty<MediaRecordView>();
        let idx = 0;
        while (idx < vector::length(&order.media_records)) {
            let record_ref = vector::borrow(&order.media_records, idx);
            vector::push_back(&mut views, MediaRecordView {
                stage: record_ref.stage,
                category: clone_string(&record_ref.category),
                hash: clone_bytes(&record_ref.hash),
                timestamp: record_ref.timestamp,
            });
            idx = idx + 1;
        };

        views
    }

    // Allow integration modules (or tests) to toggle insurance claim blocks.
    public fun set_insurance_block_for_test(order_id: u64, blocked: bool) acquires OrderBook {
        assert!(exists<OrderBook>(@haigo), error::not_found(E_NOT_INITIALIZED));
        let book = borrow_global_mut<OrderBook>(@haigo);
        let order = borrow_order_mut(&mut book.orders, order_id);
        order.insurance_blocked = blocked;
    }

    // Test helper to initialise book when running unit tests.
    #[test_only]
    public fun init_for_test(admin: &signer, platform_account: address, timeline_enabled: bool) acquires OrderBook {
        if (!exists<OrderBook>(@haigo)) {
            init_module(admin);
        };
        let book = borrow_global_mut<OrderBook>(@haigo);
        book.platform_account = platform_account;

        if (timeline_enabled) {
            if (option::is_none(&book.timeline_events)) {
                book.timeline_events = option::some(vector::empty<TimelineEntry>());
            };
        } else {
            book.timeline_events = option::none();
        };

        book.timeline_enabled = timeline_enabled;
    }

    // -------- Internal helpers below this line --------

    fun borrow_order_mut(orders: &mut Table<u64, Order>, order_id: u64): &mut Order {
        assert!(table::contains(orders, order_id), error::not_found(E_ORDER_NOT_FOUND));
        table::borrow_mut(orders, order_id)
    }

    fun new_media_record(stage: u8, category: String, hash: vector<u8>, timestamp: u64): MediaRecord {
        assert_hash_valid(&hash);
        MediaRecord {
            stage,
            category,
            hash,
            timestamp,
        }
    }

    fun assert_hash_valid(hash: &vector<u8>) {
        let length = vector::length(hash);
        assert!(length == 32, error::invalid_argument(E_INVALID_MEDIA_HASH));
    }

    fun emit_order_created(book: &mut OrderBook, order_id: u64) {
        let order = table::borrow(&book.orders, order_id);
        let media_snapshot = vector::empty<MediaRecord>();
        let idx = 0;
        while (idx < vector::length(&order.media_records)) {
            let record_ref = vector::borrow(&order.media_records, idx);
            vector::push_back(&mut media_snapshot, copy_media(record_ref));
            idx = idx + 1;
        };

        event::emit_event(&mut book.order_created_events, OrderCreated {
            order_id,
            seller: order.seller,
            warehouse: order.warehouse,
            pricing: order.pricing,
            logistics_inbound: clone_option_string(&order.logistics_inbound),
            timestamp: order.created_at,
            media: media_snapshot,
        });
    }

    fun emit_checked_in(book: &mut OrderBook, order_id: u64, inbound_logistics: &String) {
        let order = table::borrow(&book.orders, order_id);
        let last_media = vector::borrow(&order.media_records, vector::length(&order.media_records) - 1);
        let timestamp = option_u64_or(&order.checked_in_at, order.created_at);

        event::emit_event(&mut book.checked_in_events, CheckedIn {
            order_id,
            warehouse: order.warehouse,
            logistics_inbound: clone_string(inbound_logistics),
            timestamp,
            media: copy_media(last_media),
        });
    }

    fun emit_set_in_storage(book: &mut OrderBook, order_id: u64) {
        let order = table::borrow(&book.orders, order_id);
        let last_media = vector::borrow(&order.media_records, vector::length(&order.media_records) - 1);
        let timestamp = option_u64_or(&order.set_in_storage_at, order.created_at);

        event::emit_event(&mut book.set_in_storage_events, SetInStorage {
            order_id,
            warehouse: order.warehouse,
            timestamp,
            media: copy_media(last_media),
        });
    }

    fun emit_checked_out(book: &mut OrderBook, order_id: u64, operator: address, outbound_logistics: &String) {
        let order = table::borrow(&book.orders, order_id);
        let last_media = vector::borrow(&order.media_records, vector::length(&order.media_records) - 1);
        let timestamp = option_u64_or(&order.checked_out_at, order.created_at);

        event::emit_event(&mut book.checked_out_events, CheckedOut {
            order_id,
            operator,
            logistics_outbound: clone_string(outbound_logistics),
            timestamp,
            media: copy_media(last_media),
        });
    }

    fun record_timeline(book: &mut OrderBook, order_id: u64, status: u8, media_stage: Option<u8>, timestamp: u64) {
        if (!book.timeline_enabled) {
            return;
        };

        let entry = TimelineEntry { order_id, status, media_stage, timestamp };
        if (option::is_some(&book.timeline_events)) {
            let events_ref = option::borrow_mut(&mut book.timeline_events);
            vector::push_back(events_ref, entry);
        } else {
            book.timeline_events = option::some(vector::singleton(entry));
        }
    }

    fun copy_media(record_ref: &MediaRecord): MediaRecord {
        MediaRecord {
            stage: record_ref.stage,
            category: clone_string(&record_ref.category),
            hash: clone_bytes(&record_ref.hash),
            timestamp: record_ref.timestamp,
        }
    }

    fun clone_string(value: &String): String {
        let bytes_ref = string::bytes(value);
        let bytes_copy = clone_bytes(bytes_ref);
        string::utf8(bytes_copy)
    }

    fun clone_option_string(source: &Option<String>): Option<String> {
        if (option::is_some(source)) {
            option::some(clone_string(option::borrow(source)))
        } else {
            option::none()
        }
    }

    fun clone_option_u64(source: &Option<u64>): Option<u64> {
        if (option::is_some(source)) {
            option::some(*option::borrow(source))
        } else {
            option::none()
        }
    }

    fun clone_bytes(source: &vector<u8>): vector<u8> {
        let result = vector::empty<u8>();
        let len = vector::length(source);
        let i = 0;
        while (i < len) {
            let byte = *vector::borrow(source, i);
            vector::push_back(&mut result, byte);
            i = i + 1;
        };
        result
    }

    fun option_u64_or(opt: &Option<u64>, default: u64): u64 {
        if (option::is_some(opt)) {
            *option::borrow(opt)
        } else {
            default
        }
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    public fun test_full_lifecycle(aptos_framework: &signer, account: &signer) acquires OrderBook {
        timestamp::set_time_has_started_for_testing(aptos_framework);


        let platform_addr = @0xfeed;
        let platform = account::create_account_for_test(platform_addr);
        let seller_addr = @0x110;
        let seller = account::create_account_for_test(seller_addr);
        let warehouse_addr = @0x220;
        let warehouse = account::create_account_for_test(warehouse_addr);

        registry::init_for_test(account);
        registry::register_seller(&seller, registry::hash_algorithm_blake3(), string::utf8(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        registry::register_warehouse(&warehouse, registry::hash_algorithm_blake3(), string::utf8(b"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
        registry::register_platform_operator(&platform, registry::hash_algorithm_blake3(), string::utf8(b"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"));

        init_for_test(account, platform_addr, true);

        aptos_framework::coin::create_coin_conversion_map(aptos_framework);
        mock_coin::ensure_initialized(account);
        mock_coin::register(&seller);
        mock_coin::register(&platform);
        mock_coin::mint(account, seller_addr, 1_000_000);

        create_order<mock_coin::MockCoin>(
            &seller,
            warehouse_addr,
            option::some(string::utf8(b"TRACK-100")),
            500_000,
            100_000,
            50_000,
            option::some(string::utf8(b"init")),
            option::some(make_hash(1)),
        );

        check_in(&warehouse, 1, string::utf8(b"TRACK-100"), string::utf8(b"inbound"), make_hash(2));
        set_in_storage(&warehouse, 1, string::utf8(b"storage"), make_hash(3));
        check_out(&platform, 1, string::utf8(b"TRACK-100-OUT"), string::utf8(b"outbound"), make_hash(4));

        let summary = get_order_summary(1);
        assert!(summary.status == ORDER_STATUS_WAREHOUSE_OUT, 100);
        assert!(option::is_some(&summary.checked_out_at), 101);

        let pricing = get_pricing(1);
        assert!(pricing.total == 650_000, 102);

        let media = get_media(1);
        assert!(vector::length(&media) == 4, 103);
        let last = vector::borrow(&media, 3);
        assert!(last.stage == MEDIA_STAGE_OUTBOUND, 104);
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    #[expected_failure(abort_code = 0x50005, location = registry)]
    public fun test_create_order_requires_seller_role(aptos_framework: &signer, account: &signer) acquires OrderBook {
        timestamp::set_time_has_started_for_testing(aptos_framework);

        let platform_addr = @0xee;
        let platform = account::create_account_for_test(platform_addr);
        let seller_addr = @0x440;
        let seller = account::create_account_for_test(seller_addr);
        let warehouse_addr = @0x550;
        let warehouse = account::create_account_for_test(warehouse_addr);

        registry::init_for_test(account);
        registry::register_warehouse(&warehouse, registry::hash_algorithm_blake3(), string::utf8(b"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"));
        registry::register_platform_operator(&platform, registry::hash_algorithm_blake3(), string::utf8(b"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"));

        init_for_test(account, platform_addr, false);

        create_order<mock_coin::MockCoin>(
            &seller,
            warehouse_addr,
            option::none(),
            1,
            0,
            0,
            option::none(),
            option::none(),
        );
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    #[expected_failure(abort_code = 0x10005, location = Self)]
    public fun test_invalid_hash_rejected(aptos_framework: &signer, account: &signer) acquires OrderBook {
        timestamp::set_time_has_started_for_testing(aptos_framework);


        let platform_addr = @0x990;
        let platform = account::create_account_for_test(platform_addr);
        let seller_addr = @0x660;
        let seller = account::create_account_for_test(seller_addr);
        let warehouse_addr = @0x770;
        let warehouse = account::create_account_for_test(warehouse_addr);

        registry::init_for_test(account);
        registry::register_seller(&seller, registry::hash_algorithm_blake3(), string::utf8(b"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
        registry::register_warehouse(&warehouse, registry::hash_algorithm_blake3(), string::utf8(b"0101010101010101010101010101010101010101010101010101010101010101"));
        registry::register_platform_operator(&platform, registry::hash_algorithm_blake3(), string::utf8(b"0202020202020202020202020202020202020202020202020202020202020202"));

        init_for_test(account, platform_addr, false);

        aptos_framework::coin::create_coin_conversion_map(aptos_framework);
        mock_coin::ensure_initialized(account);
        mock_coin::register(&seller);
        mock_coin::register(&platform);
        mock_coin::mint(account, seller_addr, 10_000);

        create_order<mock_coin::MockCoin>(
            &seller,
            warehouse_addr,
            option::none(),
            1,
            0,
            0,
            option::none(),
            option::none(),
        );

        check_in(&warehouse, 1, string::utf8(b"L1"), string::utf8(b"inbound"), make_hash(5));

        // Hash only 4 bytes, should trigger E_INVALID_MEDIA_HASH
        set_in_storage(
            &warehouse,
            1,
            string::utf8(b"storage"),
            make_hash_with_length(9, 4),
        );
    }

    #[test(aptos_framework = @0x1, account = @haigo)]
    #[expected_failure(abort_code = 0x30008, location = Self)]
    public fun test_checkout_blocked_by_insurance(aptos_framework: &signer, account: &signer) acquires OrderBook {
        timestamp::set_time_has_started_for_testing(aptos_framework);


        let platform_addr = @0x880;
        let platform = account::create_account_for_test(platform_addr);
        let seller_addr = @0x9901;
        let seller = account::create_account_for_test(seller_addr);
        let warehouse_addr = @0xaa02;
        let warehouse = account::create_account_for_test(warehouse_addr);

        registry::init_for_test(account);
        registry::register_seller(&seller, registry::hash_algorithm_blake3(), string::utf8(b"3333333333333333333333333333333333333333333333333333333333333333"));
        registry::register_warehouse(&warehouse, registry::hash_algorithm_blake3(), string::utf8(b"4444444444444444444444444444444444444444444444444444444444444444"));
        registry::register_platform_operator(&platform, registry::hash_algorithm_blake3(), string::utf8(b"5555555555555555555555555555555555555555555555555555555555555555"));

        init_for_test(account, platform_addr, false);

        aptos_framework::coin::create_coin_conversion_map(aptos_framework);
        mock_coin::ensure_initialized(account);
        mock_coin::register(&seller);
        mock_coin::register(&platform);
        mock_coin::mint(account, seller_addr, 100_000);

        create_order<mock_coin::MockCoin>(
            &seller,
            warehouse_addr,
            option::none(),
            10,
            0,
            0,
            option::none(),
            option::none(),
        );

        check_in(&warehouse, 1, string::utf8(b"L1"), string::utf8(b"inbound"), make_hash(6));
        set_in_storage(&warehouse, 1, string::utf8(b"storage"), make_hash(7));

        set_insurance_block_for_test(1, true);

        check_out(&platform, 1, string::utf8(b"L1-OUT"), string::utf8(b"outbound"), make_hash(8));
    }

    fun make_hash(fill: u8): vector<u8> {
        make_hash_with_length(fill, 32)
    }

    fun make_hash_with_length(fill: u8, length: u64): vector<u8> {
        let bytes = vector::empty<u8>();
        let i = 0;
        while (i < length) {
            vector::push_back(&mut bytes, fill);
            i = i + 1;
        };
        bytes
    }
}
