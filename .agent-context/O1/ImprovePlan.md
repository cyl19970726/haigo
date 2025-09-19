# O1 Improve Plan — Close Gaps & Harden E2E

Scope
- Make draft→on‑chain linking deterministic; fix pricing data; formalize state mapping; persist ingestion cursors; strengthen types, security, and observability. Keep compatibility with current FE and Move.

Deliverables
- API: attach‑tx endpoint to bind wallet submission to an existing draft UID.
- Repository: merge on‑chain events into the original draft row when possible.
- Pricing: correct list/detail pricing without schema drift; optional migration to denormalize later.
- Listener: persisted cursor + metrics; controlled start window; improved backoff.
- Types & validation: strict event payload, address normalization.
- Security & flags: rate limiting for drafts; feature flag for listener.
- Tests: unit/integration for new flows; smoke script.

Changes
- Backend (BFF)
  - Add `POST /api/orders/drafts/:recordUid/attach-tx`:
    - Request: `{ txnHash: string }`; Response: `{ ok: true }`.
    - Persist `orders.txn_hash = <hash>` for the draft row; optionally `orders.status = ORDER_DRAFT` remains until event arrives.
  - OrdersRepository
    - `attachTransaction(recordUid, txnHash)` to save the hash on the draft row.
    - `upsertOnchainCreated(evt)` behavior:
      - If `evt.txnHash` present and a draft row exists with same `txn_hash` (or a separate draft‑tx link), update that row in place (status→`ONCHAIN_CREATED`, set `order_id/txn_version/event_index/chain_timestamp`).
      - Else, create `order-{orderId}-{hash8?}` as today.
  - Pricing resolution
    - `listSummaries/getDetail`: if `status=ORDER_DRAFT`, return `payloadJson.pricing`; if on‑chain, look up the latest `OrderCreated` for that `recordUid` and return `data.pricing` (fallback to `payloadJson.pricing` if needed).
    - Optional migration (later): add `amount_subunits/insurance_fee_subunits/platform_fee_subunits/total_subunits` in `orders` and hydrate in both draft save and event upsert.
  - State mapping
    - Replace `replace('ONCHAIN_', '')` with a typed mapper: `ORDER_DRAFT -> PENDING`, `ONCHAIN_CREATED -> CREATED`, others map directly.
  - Persisted cursor
    - Create table `event_cursors(stream_name text primary key, last_txn_version bigint, last_event_index bigint, updated_at timestamp)`.
    - Load on bootstrap; update after each processed batch; expose `order_listener_last_version` from DB value.
  - Listener controls & backoff
    - Env flags: `ENABLE_ORDER_LISTENER=true|false`, `ORDER_INGESTOR_*` already exist; ensure all requests add both API‑key headers when configured.
    - Keep exponential backoff with jitter; cap by `ORDER_INGESTOR_MAX_PAGES_PER_TICK`.
  - Types & normalization
    - Define `OrderCreatedPayload` with snake/camel aliases; normalize addresses to lowercase `0x`.
  - Security
    - Add basic rate limiting for `POST /api/orders/drafts` (per IP and address). Keep nonce/signature validation in backlog.

- Frontend (FE)
  - After wallet returns `txnHash`, call `POST /api/orders/drafts/:recordUid/attach-tx` if a draft UID is present.
  - Keep deriving `recordUid` from `orderId+txnHash` as an optimization; detail fetch should try: 1) event‑derived UID; 2) fallback to draft UID if present.
  - Confirm `?warehouse=` preselect works (already implemented).

- Database
  - `event_cursors` table for listener; optional later migration to denormalize pricing in `orders`.

- Observability
  - Metrics already expose last version+errors; add listener status log on bootstrap with start version and flags. Consider alerting on repeated backoff.

Tests
- Unit
  - Repository: draft create, attach‑tx, upsertOnchainCreated merging path (with/without draft), pricing resolution from `payloadJson` vs. event.
  - Listener: process event updates cursor and calls `applyOrderCreatedEvent` with normalized payload; error backoff increments counter.
- Integration
  - Controller: POST draft → attach‑tx → simulate event → GET detail should return transactionHash for the original draft UID.
- Smoke script
  - `apps/bff/scripts/seed-order-created.mjs <uid>` to insert an `OrderCreated` row and drive repository upsert for quick verification.

Acceptance Criteria (updated)
- Within 30s of on‑chain confirmation, either:
  - a) FE uses event‑derived `recordUid` and GET detail returns `status=CREATED` + `transactionHash`; or
  - b) FE attaches `txnHash` to the draft and GET detail using the original draft UID returns `status=CREATED` + `transactionHash`.
- List/detail pricing reflects non‑zero values from draft payload or event.
- `/metrics` shows advancing `order_listener_last_version`; errors do not permanently stall ingestion.

Risks & Mitigations
- Missing txn hash on some gateways → continue to accept draft path and fallback to latest event pricing; expose retry.
- Listener restart storms → persisted cursor + max pages per tick + backoff jitter.
- Rate limiting false positives → allowlist internal IPs in non‑prod.

Rollout
- Phase 1: backend attach‑tx + pricing fix + mapper + tests.
- Phase 2: cursor table + listener wiring + metrics hookup.
- Phase 3: optional pricing denormalization + extended security.

