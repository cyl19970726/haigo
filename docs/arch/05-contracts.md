# Contracts

## Registry (haigo::registry)
- Entry 初始化：`move/sources/registry.move:75` 建立 `Registry` 资源与事件句柄。
- 注册入口：`register_seller` 与 `register_warehouse` 分别位于 `move/sources/registry.move:112` 与 `move/sources/registry.move:155`，校验 64 长度 BLAKE3 哈希并写入 `AccountRecord`。
- 事件定义：`SellerRegistered`/`WarehouseRegistered`（`move/sources/registry.move:44`, `move/sources/registry.move:55`）提供链下去重所需的 `sequence` 字段。
- 哈希校验：`validate_hash` 限制字符集与长度（`move/sources/registry.move:84`）。
- 角色断言：`ROLE_SELLER/ROLE_WAREHOUSE` 常量（`move/sources/registry.move:17`）供订单模块引用。

```move
// move/sources/registry.move:112
public entry fun register_seller(
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
        role: ROLE_SELLER,
        hash_algorithm,
        hash_value: hash_value,
        timestamp: current_time,
    };

    table::add(&mut registry.accounts, account_addr, record);
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
```

## Orders (haigo::orders)
- 初始化：`init_module` 负责构建 `OrderBook`（`move/sources/orders.move:152`）。
- 创建订单：`create_order` 执行角色校验/资金转移/事件发射（`move/sources/orders.move:196`）。
- 仓库入库：`check_in` 更新状态并写入媒体记录（`move/sources/orders.move:269`）。
- 时间线控制：`timeline_enabled` 与 `TimelineEntry` 结构定义在 `move/sources/orders.move:84`、`move/sources/orders.move:59`，后续可开放给链下索引。
- 错误码：`E_INVALID_STATUS_TRANSITION`、`E_MEDIA_STAGE_MISMATCH` 等集中在 `move/sources/orders.move:19`。

```move
// move/sources/orders.move:196
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
    staking::assert_min_credit(seller_addr, total);
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

// move/sources/orders.move:269
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
```

## Staking (haigo::staking)
- 信用守卫：`assert_min_credit` 校验质押额度（`move/sources/staking.move:12`）。
- 测试辅助：`init_for_test` 与 `set_credit` 便于单元测试设置额度（`move/sources/staking.move:26`, `move/sources/staking.move:35`）。

## Supporting Modules
- Mock Coin：测试环境货币在 `move/sources/mock_coin.move:1`，提供 `mint`/`register` 与 capability 管理。
- Placeholder：`move/sources/haigo.move:1` 保留编译占位，后续可扩展通用工具。
- 包配置：`move/Move.toml:1` 声明 `haigo` 资源账户与 Aptos Framework 依赖。

## Planned Modules
- Insurance：理赔入口函数拟定在 `move/sources/insurance.move (planned)`，事件 `ClaimOpened`/`ClaimResolved` 将与 Docs 数据流一致。
- Reputation：评分与链下评价哈希将在 `move/sources/reputation.move (planned)` 维护，结合 staking 权重调整信用。

## Deployment Notes
- 部署顺序：`registry` → `staking`（可选） → `orders`，再执行 `orders::configure` 设置平台账户（`move/sources/orders.move:171`）。
- 兼容性：升级前运行 `aptos move prove` 与 `compatibility_check`，确保结构保持。
- 环境地址：`Move.toml` 使用 `dev-addresses` 将 `haigo` 映射至 `0xA11CE`（`move/Move.toml:14`）。上线后需更新 `packages/shared/src/config/aptos.ts:23` 与 `.env` 参数。
