# Seller Dashboard Warehouse Experience Plan

## 1. Background & Problem Statement
- Current `/dashboard/seller` only surfaces a "查找合作仓库" card that links out to `/warehouses`, forcing context-switching and exposing an empty directory view.
- Sellers should evaluate warehouses (availability, staking score, capacity, storage fee) and initiate orders without leaving the dashboard.
- Updated direction: keep `SellerQuickActionsCard` and `SellerRecentOrdersCard` on the first row, and render the warehouse discovery experience immediately beneath them, using shadcn/ui primitives that reflect real backend data models.

## 2. Objectives & Success Criteria
- Use existing `WarehouseSummary` data (`id`, `address`, `name`, `stakingScore`, `creditCapacity`, `insuranceCoverage`, `availability`, `mediaSamples`, `serviceAreas`, `lastAuditAt`, `feePerUnit`) to render both list and detail experiences with no invented fields.
- Provide two CTAs per warehouse:
  - `查看详情` → opens an information sheet/dialog populated purely from `WarehouseSummary` (plus future optional detail endpoint).
  - `立即下单` → launches an inline order micro-flow that reuses `useOrderDraft`, Aptos wallet context, and the Move `create_order` entry point.
- Clarify every UI button’s backend/contract interaction (REST endpoints, payloads, expected responses, Aptos SDK usage) so implementation aligns with wallet + Move backend.
- Maintain performant, responsive, and accessible UI using shadcn/ui. Mobile UX must remain touch-friendly.

## 3. Reference Data Models & Services
- `packages/shared/src/dto/orders.ts` → `WarehouseSummary`, `PricingBreakdown`, `OrderSummaryDto`, etc.
- BFF endpoints (Nest):
  - `GET /api/warehouses` (`DirectoryController.list`).
  - `POST /api/orders/drafts`, `POST /api/orders/drafts/:recordUid/attach-tx`, `GET /api/orders` (`OrdersController`).
- Wallet context: `apps/web/lib/wallet/context.tsx` exposes `useWalletContext` with `accountAddress`, `aptos` SDK instance, `signAndSubmitTransaction` (wrapper from `@aptos-labs/wallet-adapter-react`).
- Move contract: `ORDERS_MODULE_ADDRESS::orders::create_order` (see `packages/shared/src/config/aptos.ts`). The function signature matches arguments built in `CreateOrderView.buildTransactionPayload`.

## 4. UX Flow & ASCII Wireframes

### 4.1 Dashboard Layout
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HaiGo Seller header + welcome copy                           [Sign Out btn] │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ ConfigurationNotice (conditional)                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────┬────────────────────────────────────────────┐ │
│ │ SellerQuickActionsCard      │ SellerRecentOrdersCard                     │ │
│ │ (existing component)        │ (uses OrderSummaryDto data)                │ │
│ └─────────────────────────────┴────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│ 仓库目录（SellerWarehouseDirectoryCard）                                     │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Filters row:                                                              │ │
│ │  [搜索 name/address ▢] [服务区域 ▢] [评分 ▽] [费率 ▽] [仅显示可用 ☑] [重置] │ │
│ │ ──────────────────────────────────────────────────────────────────────── │ │
│ │ Card grid (md:2, lg:3 columns) built with shadcn Card                    │ │
│ │ ┌──────────────────────────────┐  ┌──────────────────────────────┐       │ │
│ │ │ 仓库名称                      │  │ 仓库名称                      │  ...  │ │
│ │ │ 0xabc… 地址                   │  │ 0xdef… 地址                   │       │ │
│ │ │ 标签: Availability badge      │  │ 标签: Availability badge      │       │ │
│ │ │ ──────────────────────────── │  │ ──────────────────────────── │       │ │
│ │ │ Staking score: 96            │  │ Staking score: 87            │       │ │
│ │ │ Credit capacity: 12,000 APT  │  │ Credit capacity: 8,500 APT   │       │ │
│ │ │ Storage fee: 32 bps (0.32%)  │  │ Storage fee: 45 bps (0.45%)  │       │ │
│ │ │ Last audit: 2024-08-03       │  │ Last audit: 2024-09-12       │       │ │
│ │ │ Service areas: 华东, 华北      │  │ Service areas: 华南            │       │ │
│ │ │ Media tags: cold-storage…     │  │ Media tags: reef…             │       │ │
│ │ │ [查看详情] [立即下单]          │  │ [查看详情] [立即下单]          │       │ │
│ │ └──────────────────────────────┘  └──────────────────────────────┘       │ │
│ │ Footer: Pagination + "共 N 个仓库" + 缓存命中徽章 + 更新时间              │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```
- Mobile: filters collapse into shadcn `Sheet` triggered by `筛选`; grid becomes single-column cards with action row pinned at bottom.

### 4.2 `查看详情`（WarehouseDetailsDialog/Sheet）
```
Desktop Dialog
┌─────────────────────────────────────────────────────┐
│ 仓库名称                                 [✖]       │
│ 地址: 0xabc...                                     │
├─────────────────────────────────────────────────────┤
│ Availability badge (available/limited/maintenance) │
│ Staking score: 96                                  │
│ Credit capacity: 12,000 APT                        │
│ Storage fee: 32 bps (0.32%)                        │
│ Insurance coverage: — (render only if present)     │
│ Service areas: 华东, 华北                           │
│ Media samples: • cold-chain • live-track           │
│ Last audit: 2024-08-03                              │
├─────────────────────────────────────────────────────┤
│ 操作: [复制地址] [前往创建订单] [关闭]               │
└─────────────────────────────────────────────────────┘

Mobile Sheet
┌─────────────────────────────────────────────────────┐
│ ── 仓库名称 (badge)                                 │
├─────────────────────────────────────────────────────┤
│ 详细字段同上；纵向滚动                              │
├─────────────────────────────────────────────────────┤
│ Sticky footer: [复制地址] [前往创建订单]             │
└─────────────────────────────────────────────────────┘
```

### 4.3 `立即下单` Inline Micro-Flow (Dialog/Sheet)
```
┌─────────────────────────────────────────────────────┐
│ 下单：{warehouse.name}                              │
│ 地址: 0xabc…                                        │
├─────────────────────────────────────────────────────┤
│ Step 1: 仓库确认（只读）                             │
│  • 仓库: {warehouse.name} ({warehouse.address})     │
│  • Storage fee (bps): {formatBps(warehouse.feePerUnit)} │
│ Step 2: 物流信息                                     │
│  • Carrier select                                   │
│  • Tracking number input                            │
│  • 备注 textarea                                    │
│ Step 3: 媒资 (可选)                                  │
│  • Hash input (64 hex) + Category select            │
│ Pricing Preview                                      │
│  • Derived via `calculatePricing` + insurance/platform fee config |
│ Simulation status (optional): Show spinner/gas output |
├─────────────────────────────────────────────────────┤
│ Footer: [取消] [生成草稿并提交交易]                  │
└─────────────────────────────────────────────────────┘
```
- Mobile uses `Sheet` with sticky footer CTA.

## 5. API & Contract Interaction Mapping
| UI Element | Action | Endpoint / Module | Payload / Params | Notes |
|------------|--------|-------------------|------------------|-------|
| Filters (`搜索/服务区域/评分/费率/分页/仅显示可用`) | Fetch directory | `GET /api/warehouses` | Query string `available`, `minScore`, `maxFeeBps`, `area`, `q`, `sort`, `page`, `pageSize` | Implement via `useWarehouseDirectory`; debounce search 300 ms. |
| `查看详情` button | Open dialog only | — | — | Uses preloaded `WarehouseSummary`; no additional API. |
| `复制地址` | Clipboard copy | — | `warehouse.address` | Use `navigator.clipboard.writeText`; toast success/failure. |
| `前往创建订单` | Navigate | `/orders/new?warehouse={address}` | — | Reuses existing multi-step order wizard. |
| `立即下单` CTA | Open inline order dialog | — | Pass `warehouse` object to dialog | Dialog orchestrates draft + transaction flow described below. |
| `生成草稿并提交交易` | Draft + Move tx + attach hash + refresh | (1) `POST /api/orders/drafts` (body `{ sellerAddress, warehouseAddress, inboundLogistics, pricing, initialMedia }`), (2) Aptos `ORDERS_MODULE_ADDRESS::orders::create_order`, (3) `POST /api/orders/drafts/{recordUid}/attach-tx` (body `{ txnHash }`), (4) `GET /api/orders` | Reuse existing helpers `useOrderDraft`, `deriveInboundLogistics`, `buildTransactionPayload`, `attachDraftTransaction`, `fetchOrderSummaries`. |
| `重试` (directory error) | Refetch | `GET /api/warehouses` | — | Calls hook `refetch`. |
| Pagination controls | Update page/pageSize | `GET /api/warehouses` | Query `page`, `pageSize` | Controlled by hook state. |
| Dashboard order refresh | After successful order submit | `GET /api/orders` | Query defaults to seller address | Already used in `SellerRecentOrdersCard`; call `refreshOrders`. |

## 6. Wallet & Move Contract Integration (Inline Order Dialog)
1. **Wallet access**
   - Import `useWalletContext` (from `apps/web/lib/wallet/context`).
   - Extract `status`, `accountAddress`, `aptos`, `signAndSubmitTransaction`, `connect`.
   - If status !== `connected`, disable submit button and surface CTA to connect (tapping runs `connect(walletName)` or opens wallet chooser modal).

2. **Draft creation**
   - On submit, call `createDraft` from `useOrderDraft` with payload:
     ```ts
     await createDraft({
       sellerAddress: accountAddress.toLowerCase(),
       warehouseAddress: warehouse.address.toLowerCase(),
       inboundLogistics: deriveInboundLogistics({ carrier, trackingNumber, notes }),
       pricing: calculatePricing({ amountApt, insuranceRateBps, platformFeeBps }),
       initialMedia: mediaHash ? { category: mediaCategory, hashValue: mediaHash } : null
     });
     ```
   - Handle errors surfaced via hook (display shadcn `Alert` and keep dialog open).

3. **Build Move payload** (reuse `CreateOrderView.buildTransactionPayload` logic):
   ```ts
   const payload: InputGenerateTransactionPayloadData = {
     function: `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::create_order`,
     typeArguments: [APTOS_COIN_TYPE],
     functionArguments: [
       warehouse.address, // address of warehouse
       inboundLogistics ?? null, // BCS-encoded string or null
       pricing.amountSubunits.toString(),
       pricing.insuranceFeeSubunits.toString(),
       pricing.platformFeeSubunits.toString(),
       mediaCategory ?? null,
       mediaBytes ?? null // derived from media hash if provided
     ]
   };
   ```
   - Calculate `mediaBytes` via `hexToBytes(mediaHash)` (already exported in order feature).

4. **Simulation (optional but recommended)**
   - Similar to `CreateOrderView.simulateOrder`:
     ```ts
     const transaction = await aptos.transaction.build.simple({ sender: accountAddress, data: payload });
     const [result] = await aptos.transaction.simulate.simple({ transaction });
     ```
   - Display gas estimate (`gas_used * gas_unit_price / OCTA_PER_APT`). On failure show error toast.

5. **Signing & submitting**
   - Prefer wallet adapter `signAndSubmitTransaction` if available:
     ```ts
     const response = await signAndSubmitTransaction({ sender: accountAddress, data: payload });
     const txnHash = response.hash ?? response?.transactionHash;
     ```
   - Fallback to manual flow if wallet lacks signing (use `aptos.transaction.build.simple` + `aptos.transaction.signAndSubmitTransaction`).

6. **Confirmation polling**
   - Reuse `pollTransaction` helper from `CreateOrderView` to query `aptos.transaction.getTransactionByHash` until success/failure.
   - On failure, surface reason, mark draft as error (optionally call backend to cancel?).

7. **Attach on backend**
   - After confirmed success, post hash to BFF:
     ```ts
     await attachDraftTransaction(recordUid, txnHash);
     ```
   - Then call `fetchOrderSummaries` to refresh dashboard orders.

8. **State transitions**
   - Maintain local state machine (`idle` → `drafting` → `simulating` → `signing` → `submitted` → `confirmed` or `failed`).
   - Disable dialog closure while submitting, but allow cancel once process completes.
   - On success, show shadcn `Toast` “订单已提交” with link to order detail.

## 7. Component Implementation Checklist
1. **Layout Refactor**: update `apps/web/app/dashboard/seller/page.tsx` to grid layout and insert new directory card.
2. **Directory Card**: build `SellerWarehouseDirectoryCard` hooking into `useWarehouseDirectory`, render filters, grid, states, pagination.
3. **Summary Card**: extend or reuse existing `apps/web/features/directory/WarehouseCard.tsx` to include action bar + integrate with new dialogs (consider refactor for shared component).
4. **Dialogs**: implement `WarehouseDetailsDialog` and `WarehouseOrderDialog` with wallet-aware flow, using shadcn `Dialog`/`Sheet`, `Button`, `Badge`, `Skeleton`, `Alert`, `Toast`.
5. **Shared helpers**: Factor out `formatBps`, `formatApt`, and transaction helpers (`buildOrderPayload`, `pollTransaction`) into `apps/web/features/orders/utils.ts` so both dialogs and `CreateOrderView` reuse same logic.
6. **Error Handling**: consistent messaging for API failures, wallet disconnect, Move errors.
7. **Testing**: RTL coverage for render states, dialog interactions, wallet guard rails (mock `useWalletContext`), API mocking for drafts and attach flow, pagination and filter logic.

## 8. Dependencies & Open Questions
- Ensure `WarehouseSummary` contains all required fields (currently no contact info—future enhancement if product desires).
- Inline order dialog must share validation with existing wizard; consider extracting form schema to avoid divergence.
- Confirm `signAndSubmitTransaction` return shape across wallets (hash property naming) and handle gracefully.
- Decide on analytics events for directory interactions and order submissions.
- Determine whether inline flow should enforce network check (e.g., guard if wallet on wrong network using `networkStatus.isMatch`).

## 9. Rollout & Follow-up
- QA scenario matrix: desktop/mobile, wallet disconnected, simulation failure, Move failure, backend draft failure, successful order.
- Optional feature flag gating new inline order; if omitted, coordinate release with backend readiness.
- Post-release telemetry: number of inline orders, success rate, filter usage.
- Future work: extend warehouse detail data (audit reports, testimonials), allow “favorite” warehouses, integrate AI recommendations.

