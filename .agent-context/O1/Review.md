# O1 Implementation Review — Orders Creation & On‑Chain Sign

Summary
- End‑to‑end path is largely implemented. DB models, BFF APIs, Indexer listener with Fullnode fallback, metrics, and FE flows are present. A few high‑impact gaps remain that affect acceptance predictability and data correctness.

Status Snapshot
- Completed
  - Prisma models and migration: `apps/bff/prisma/schema.prisma:59` (OrderStatus/Order/OrderEvent), migration `apps/bff/prisma/migrations/2025-09-19_001_o1_orders/migration.sql:1`.
  - BFF Orders module: controller/service/repository wired and exported via `apps/bff/src/modules/app.module.ts:27`.
  - Listener with Fullnode fallback and backoff: `apps/bff/src/modules/orders/orders-event-listener.service.ts:36`.
  - Metrics endpoint and gauges/counters: `/metrics` in `apps/bff/src/modules/metrics/metrics.controller.ts:5`; `order_listener_last_version`/`order_listener_error_total` in `apps/bff/src/modules/metrics/metrics.service.ts:46`/`:49`.
  - FE flows: Seller dashboard entry, directory listing CTA to `/orders/new?warehouse=...`, CreateOrderView uses `useSearchParams` to preselect and `useOrderDraft` to create drafts.
  - Basic tests present: `apps/bff/test/orders.repository.spec.ts`, `apps/bff/test/orders.controller.spec.ts`.
- Partially Completed
  - Listener cursor is in‑memory only; not persisted across restarts.
  - Backoff/throttling exists but lacks persistent cursor + richer health/alerting.
  - Draft security is minimal (format checks only); nonce/signature gating is a reserved slot.
  - FE uses recordUid derived from event (orderId + txnHash) instead of the draft UID for post‑submit lookup.
- Missing / Needs Fix
  - Pricing values in list/detail return 0 because `orders` table does not store `amountSubunits` etc., while repository reads such fields. Source should be `payloadJson.pricing` for drafts or latest `OrderCreated.data.pricing` for on‑chain.
  - Draft→on‑chain linking not deterministic: listener creates `recordUid=order-{orderId}-{hash8}` instead of updating the original draft row. This breaks the “draft UID becomes resolvable within 30s” acceptance path.

Key Findings (with anchors)
- Draft UID generation and usage
  - Drafts: `draft-${Date.now()}-...` in `apps/bff/src/modules/orders/orders.repository.ts:9`.
  - On‑chain upsert generates new UID: `order-${orderId}-{hash8?}` in `apps/bff/src/modules/orders/orders.repository.ts:22`.
  - FE derives recordUid from `orderId+txnHash` post‑confirm: `apps/web/features/orders/create/CreateOrderView.tsx:423`.
- Pricing mapping
  - Repository maps fields that do not exist in schema: `apps/bff/src/modules/orders/orders.repository.ts:321` and `:345` read `amountSubunits` etc.; `Order` model only has `payloadJson`/events.
- State mapping
  - Output trims `ONCHAIN_` via string replace (`status.replace('ONCHAIN_', '')`), not a robust mapping: `apps/bff/src/modules/orders/orders.repository.ts:318`, `:342`.
- Cursor & ingestion
  - In‑memory cursor with optional “start from latest”/offset and backoff present: `apps/bff/src/modules/orders/orders-event-listener.service.ts:86` and `:173`.
  - No DB‑persisted cursor table to avoid duplicate scanning across restarts.
- Config & headers
  - Env mapping present in `apps/bff/src/common/configuration.js:7` (`APTOS_INDEXER_URL/APTOS_NODE_API_URL/APTOS_NODE_API_KEY`). Listener sends both `x-aptos-api-key` and `Authorization: Bearer`.

Impact on Acceptance
- Without deterministic draft→on‑chain merge, `/api/orders/:recordUid` using the draft UID will continue to 404 after 30s until FE switches to event‑derived UID. This diverges from the stated acceptance and confuses draft UX.
- Pricing totals in API responses are incorrect (zeros), impacting review pages and lists.

Recommendations (priority)
1) Draft Linking (High):
   - Add `POST /api/orders/drafts/:recordUid/attach-tx { txnHash }` after wallet submit. In listener, when processing an `OrderCreated`, preferentially update the draft row matched by attached `txnHash` rather than creating a new `order-*` UID. Fallback to create if no draft link exists.
2) Pricing Mapping (High):
   - Short‑term: repository should return pricing from `payloadJson.pricing` for drafts and from the latest `OrderCreated.data.pricing` for on‑chain records.
   - Mid‑term: add columns to `orders` for normalized pricing and backfill from events for query performance.
3) State Mapping (Medium):
   - Introduce explicit mapper between Prisma enum and DTO enum. Avoid string replace.
4) Cursor Persistence (Medium):
   - Add `event_cursors(stream_name, last_txn_version, last_event_index, updated_at)`. Load on bootstrap, update after batch. Surface in `/metrics`.
5) Robust Types & Validation (Medium):
   - Define `OrderCreatedPayload` type (snake/camel aliases), normalize addresses (0x, lowercase), and harden parsing.
6) Security & Ops (Medium):
   - Rate limit `POST /drafts`; keep the nonce+signature plan; add feature flag `ENABLE_ORDER_LISTENER` for env‑controlled runtime.

Suggested Follow‑ups
- Extend tests to cover draft→attach‑tx→event merge, pricing resolution, and cursor persistence.
- Update docs acceptance to reflect whether FE keeps draft UID or switches to event‑derived UID.

