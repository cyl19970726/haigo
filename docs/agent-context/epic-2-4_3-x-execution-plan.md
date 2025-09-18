# Epic 2.4 & 3.x Integrated Implementation Plan (Code-Focused)

Goal: deliver Story 2.4 (Outbound Fulfillment) together with Stories 3.1–3.4 (Staking, Credit, Insurance) in one coordinated cycle, covering Move contracts, BFF/indexer services, web app, shared packages, documentation, and validation.

---
## 0. Required References & Source Material
Load these before coding or reviews:
- `docs/architecture/3-链上合约设计.md`
- `docs/architecture/4-链下服务与数据流.md`
- `docs/architecture/high-level-architecture.md`
- `docs/front-end-spec.md`
- `docs/runbook.md`
- `docs/detail/indexer-schema.md`
- `docs/prd/2-需求.md`
- Story context: `docs/stories/2.2.story.md`, `docs/stories/2.3.story.md`, `docs/stories/2.4.story.md`, `docs/stories/3.1.story.md`, `docs/stories/3.2.story.md`, `docs/stories/3.3.story.md`, `docs/stories/3.4.story.md`

Also verify tooling prerequisites:
- Aptos CLI configured for testnet, accounts funded (see `docs/runbook.md#4-move-合约流程`).
- PNPM/NPM workspaces set up (`package.json` at repo root, check Node version compliance in `docs/runbook.md#1-环境要求`).
- Prisma migrations tooling available (`packages/database` or `apps/bff/prisma`).

---
## 1. Program Structure & Tracking
1. Convert stories from Draft → "In Progress" once construction begins; maintain assignee per sub-area:
   - Move contracts: chain engineer
   - BFF/indexer + Prisma: backend engineer
   - Frontend (warehouse/staking/credit/claims/premium): frontend engineer
   - Shared packages & documentation: shared responsibility, tracked via subtasks
2. Create umbrella Epic board reflecting milestones below; use feature branches per milestone (e.g., `feature/epic3-move`, `feature/epic3-bff`, `feature/epic3-web`).
3. Enforce code owners / peer review for shared artifacts (`packages/shared`, Prisma schema) to avoid regressions.

---
## 2. Milestone 0 — Discovery & Design Sign-off (Day 0–1)
**Deliverables**
- Finalized contract change specs (error codes, storage layout) appended to `docs/architecture/3-链上合约设计.md` draft section.
- Data model diagrams & Prisma schema deltas captured in `docs/detail/indexer-schema.md` and `docs/architecture/4-链下服务与数据流.md`.
- UX alignment doc referencing component inventory in `docs/front-end-spec.md` (ensure figma references exist).

**Tasks**
- Architecture review: confirm new resources/events for staking & insurance modules, order state transitions, premium validation guard.
- Database planning: map new tables for orders/staking/credit/claims/premium config; outline migration order.
- API design review: list REST endpoints, expected payloads, error contracts within BFF pattern (`{ data, meta }`).

---
## 3. Milestone 1 — Move Layer Implementation (Day 2–5)
### 3.1 Staking Module (Story 3.1)
**Files**
- `move/sources/staking.move`
- `move/tests/staking_test.move`
- `move/scripts/deploy_staking.sh` (or TS equivalent in `scripts/`)

**Implementation Steps**
1. Define resource structs:
   ```move
   struct StakeLedger has key { ... }
   struct StakePosition has key { ... }
   ```
   - Support multi-asset (`CoinType`) positions keyed by warehouse address.
   - Maintain totals (`total_amount`, `locked_amount`).
2. Implement entry functions:
   - `public entry fun stake<CoinType>(signer &account, amount: u64, metadata: vector<u8>)` enforcing warehouse role via Registry.
   - `public entry fun unstake<CoinType>(signer &account, amount: u64)` with guard to respect `locked_amount`.
   - Emit `event StakeChanged { address, coin_type, delta, total, action, timestamp }`.
   - Preserve `assert_min_credit` interface by referencing ledger totals.
3. Add `#[view]` functions:
   - `fun get_stake<CoinType>(address): StakeSummary` returning consistent DTO.
4. Update tests in `move/tests/staking_test.move` covering:
   - Successful stake/unstake
   - Insufficient balance (expect `E_INSUFFICIENT_BALANCE`)
   - Duplicate stake metadata (if relevant)
   - Locked amount constraint
5. Deployment script ensures staking published after Registry and prior to Orders modules.

### 3.2 Insurance Claims Module (Story 3.3)
**Files**
- `move/sources/insurance.move`
- `move/tests/insurance_test.move`
- `move/scripts/deploy_insurance.sh`

**Steps**
1. Add `struct Claim` storing order id, claimant, evidence hashes, status enum, payout amount, timestamps.
2. Define events:
   - `ClaimOpened`, `ClaimResolved`
3. Implement functions:
   - `public entry fun open_claim(order_id, hashes: vector<HashValue>, amount: u64)` with guards: valid order state, no pending claim, authorized role.
   - `public entry fun resolve_claim(order_id, decision: ClaimDecision, payout: u64, memo: vector<u8>)` only for platform signer.
   - Guard helpers: `public fun assert_no_pending_claim(order_id)` for reuse in fulfillment/staking.
4. Write tests covering duplicate claim prevention, unauthorized action, payout recording, guard behavior.
5. Ensure script updates, resource account initialization documented.

### 3.3 Insurance Premium Validation (Story 3.4)
**Files**
- `move/sources/orders.move` (update `create_order` and config read logic)
- Potential new `move/sources/insurance_config.move`
- `move/tests/orders_premium_test.move`

**Steps**
1. Decide config location:
   - On-chain: create `InsurancePremiumConfig` resource keyed by admin; add `set_default_rate`, `set_override_rate` entry functions guarded by platform signer.
   - Off-chain: skip new module, ensure BFF provides rate, but still add verification structure.
2. Modify `orders::create_order` to accept expected premium, compute `required_premium` from config, compare with provided amount; emit precise error (e.g., `E_PREMIUM_MISMATCH`).
3. Handle concurrency: include config `version` param in payload; if mismatch, abort with `E_PREMIUM_STALE` to prompt refresh.
4. Tests verifying default rate, override per warehouse/category, mismatched totals.

### 3.4 Outbound Guard Alignment (Story 2.4)
- Verify `orders::check_out` arguments cover logistic manifest, media info, timestamps.
- Integrate `assert_no_pending_claim` guard.
- Confirm events include new hashes/time to support BFF ingestion.

**Outputs**
- Updated Move packages committed.
- `docs/architecture/3-链上合约设计.md` appendices updated with resource/event specs & error codes.

---
## 4. Milestone 2 — Shared Packages & Configuration (Day 4–6 overlap)
**Files**
- `packages/shared/src/dto/orders.ts`
- `packages/shared/src/dto/staking.ts`
- `packages/shared/src/dto/credit.ts`
- `packages/shared/src/dto/claims.ts`
- `packages/shared/src/dto/insurance.ts`
- `packages/shared/src/config/aptos.ts`
- `packages/shared/src/constants/errors.ts`

**Tasks**
1. Define TypeScript interfaces mirroring Move structs/events.
2. Export enums for order stages (`WAREHOUSE_OUT`), claim states, staking actions.
3. Add hash algorithm constants (`BLAKE3`, `KECCAK256`).
4. Update config with new module addresses or entry function IDs; coordinate with Story 3.1 team to avoid merge conflicts.
5. Write unit tests if repo uses `ts-jest` for shared package (`packages/shared/tests/...`).

---
## 5. Milestone 3 — BFF / Indexer Services (Day 6–11)
### 5.1 Prisma Schema & Migrations
**File**: `apps/bff/prisma/schema.prisma`

Add models:
- `Order`, `OrderEvent`, `OrderMediaAsset` (Story 2.4)
- `StakingPosition`, `StakingEvent` (Story 3.1)
- `CreditScore`, `CreditScoreLog`, `CreditWeightConfig` (Story 3.2)
- `Claim`, `ClaimEvent`, `ClaimEvidence` (Story 3.3)
- `InsuranceRate`, `InsuranceRateHistory` (Story 3.4 if off-chain managed)

Create migration: `pnpm prisma migrate dev --schema apps/bff/prisma/schema.prisma -n add-epic3-tables`

### 5.2 Orders Module (Story 2.4)
**Files**
- `apps/bff/src/modules/orders/orders.module.ts`
- `apps/bff/src/modules/orders/orders.controller.ts`
- `apps/bff/src/modules/orders/orders.service.ts`
- `apps/bff/src/modules/orders/orders.repository.ts`
- `apps/bff/src/modules/orders/orders-event-listener.service.ts`
- Tests under `apps/bff/src/modules/orders/__tests__/`

**Implementation**
1. Event listener:
   - Pull events via Indexer GraphQL: query `transactions` & `events` with module/address filters.
   - Maintain cursor table (`lastEventVersion`, `lastEventIndex`).
   - Normalize media records, compute `BLAKE3` / keccak cross-check using `@noble/hashes` or existing util.
2. Service endpoints:
   - `GET /api/orders`, `GET /api/orders/:recordUid`, `POST /api/orders/:recordUid/media-verify`.
   - Return timeline with hashes, logistic info, insurance block flag.
3. Add guard for `ORDER_INSURANCE_BLOCKED` responses.
4. Tests: mock Indexer responses, simulate insurance block, check media verification fallback.
5. Register module in `apps/bff/src/app.module.ts`.

### 5.3 Staking Module (Story 3.1)
**Files** analogous to orders under `modules/staking`.

**Key Logic**
- Event listener `StakeEventListenerService` with envs `STAKE_INGESTOR_INTERVAL_MS`, etc.
- Repository mapping events to Prisma models.
- Controller routes: `GET /api/staking/:warehouseAddress`, `GET /api/staking/:warehouseAddress/history`, `POST /api/staking/recompute` (if needed).
- Tests verifying event ingestion, API response shape, recompute logic.

### 5.4 Credit Scoring (Story 3.2)
**Files** under `modules/credit`.

**Steps**
1. Scheduler service using Nest Cron or custom interval to recompute scores.
2. Score calculation service referencing staking, orders, evaluation metrics (call BFF repositories or DB joins).
3. Controllers: `/api/credit-scores` (list with filters), `/api/credit-scores/:address/logs`.
4. Tests verifying weight adjustments, missing data handling, audit logs.

### 5.5 Insurance Claims (Story 3.3)
**Files** under `modules/claims`.

**Logic**
1. Event listener capturing `ClaimOpened`/`ClaimResolved`.
2. Controller endpoints: merchant submit (`POST /api/claims`), operations approval (`POST /api/claims/:id/resolve`), listing.
3. Integrate Aptos transaction helper to submit on-chain actions with wallet guard (reuse existing service from orders if present).
4. Tests for submission, approval, event sync, retry flows.

### 5.6 Insurance Premium Config (Story 3.4)
- If on-chain: add read-through cache service hitting view functions.
- If off-chain: create module with config CRUD endpoints, enforce RBAC (platform operator role).
- Persist rate history for audit.

### 5.7 Common Utilities
- Update `apps/bff/src/common/indexer/indexer-client.service.ts` to support new queries / pagination.
- Ensure env vars documented in `docs/runbook.md#环境变量`.

---
## 6. Milestone 4 — Web Frontend Implementation (Day 9–14)
### General
- Follow file structure from `docs/architecture/high-level-architecture.md`.
- Use hooks/services under `apps/web/lib/api` to call BFF.
- Ensure i18n keys exist if using `next-intl` or similar.
- Apply accessibility and responsive guidelines from `docs/front-end-spec.md`.

### 6.1 Outbound Fulfillment UI (Story 2.4)
**Files**
- `apps/web/app/(warehouse)/orders/[recordUid]/check-out/page.tsx`
- `apps/web/features/orders/outbound/*`
- Shared components for upload/hashes (reuse from inbound: check `apps/web/features/orders/inbound`).

**Steps**
1. Build page component hooking into router param `recordUid`.
2. Compose stepper form reusing inbound form segments (import from shared feature).
3. Implement upload component wrapper enforcing `MediaStage.outbound` constraints (size, MIME) and compute BLAKE3/keccak via WebCrypto shim.
4. Invoke `check_out` transaction via wallet provider (refer to story 2.3 implementation for pattern). Show progress states, final timeline card.
5. Display insurance block alert when API returns `ORDER_INSURANCE_BLOCKED`; include link to Runbook section.
6. Add timeline summary card with final statuses & hash badges.
7. Tests (`apps/web/features/orders/outbound/__tests__/outbound-form.test.tsx`): cover validation, hash mismatch error, success path, insurance block.

### 6.2 Staking Console (Story 3.1)
**Files**
- `apps/web/app/(dashboard)/warehouses/[address]/stake/page.tsx`
- `apps/web/features/staking/*`

**Features**
- Dashboard card showing current stake by asset.
- Line chart for history (use existing chart lib, ensure SSR compatibility).
- Call BFF for data; integrate wallet interactions for stake/unstake.
- Show transaction hash, event updates via websockets/polling.
- Tests verifying data rendering, stake action flows, error states.

### 6.3 Credit Ranking (Story 3.2)
**Files**
- `apps/web/app/(dashboard)/credit/page.tsx`
- `apps/web/features/credit/*`

**Steps**
- Implement leaderboard table (sortable columns: credit score, stake amount, completion rate).
- Provide filters (warehouse region, asset type). Use `TanStack Table` pattern if existing.
- Trend drawer/timeline for credit logs.
- Tests for sorting/filtering, log display.

### 6.4 Insurance Claims (Story 3.3)
**Files**
- `apps/web/features/claims/*`
- `apps/web/app/(warehouse)/orders/[recordUid]/claims/page.tsx`
- `apps/web/app/(ops)/claims/[claimId]/page.tsx`

**Steps**
- Merchant flow: multi-step form, upload evidence (reuse media component), preview hash badges.
- Ops flow: list view with filters, detail drawer with approve/reject buttons tied to on-chain transactions.
- Timeline showing open → resolve states, referencing event data.
- Tests for form validation, approval guard, state transitions.

### 6.5 Premium Display (Story 3.4)
**Files**
- `apps/web/features/orders/create/pricing-step.tsx`
- `apps/web/hooks/useInsuranceRates.ts`

**Steps**
- Fetch rates (BFF or on-chain view) on step load; show breakdown (base + premium) with labels for source (default vs override).
- If config version mismatch occurs (error from backend), prompt user to refresh calculation.
- Add tests verifying recalculation, version conflict message.

### 6.6 Frontend Testing & Quality
- Update `apps/web/vitest.config.ts` if new aliases introduced.
- Add MSW handlers for new APIs.
- Run `npm run lint --workspace apps/web`, `npm run test --workspace apps/web`.

---
## 7. Milestone 5 — Documentation & Operations (Day 12–15)
**Documentation Updates**
- `docs/runbook.md`: add sections for outbound manual QA, staking reconciliation, credit score recompute steps, claim approval SOP, premium adjustment walkthrough.
- `docs/architecture/3-链上合约设计.md`: append final contract details, event shapes, guard flows.
- `docs/architecture/4-链下服务与数据流.md`: update ingestion diagrams, scheduler descriptions, API list.
- `docs/detail/indexer-schema.md`: document new Prisma tables / columns.
- `docs/front-end-spec.md`: attach screen references for new UI states if absent.

**Operational Prep**
- Prepare migration guide summarizing contract upgrade order, Prisma migration commands, env vars.
- Update alerting/monitoring plan for new listeners (if using Grafana/Prom metrics).

---
## 8. Milestone 6 — End-to-End Validation & Release (Day 15–17)
**Validation Checklist**
1. **Automated**
   - `aptos move test`
   - `npm run lint --workspace apps/web`
   - `npm run test --workspace apps/web`
   - `npm run test --workspace apps/bff`
   - `pnpm prisma migrate deploy --schema apps/bff/prisma/schema.prisma` (dry-run on staging DB)
2. **Scenario Walkthroughs**
   - Warehouse outbound with media upload, insurance block scenario, final timeline verification.
   - Stake → unstake with immediate credit score recalculation reflecting new weightings.
   - Claim open (merchant) → approval (ops) → attempt outbound to confirm guard lifts; ensure credit score log references claim resolution.
   - Premium rate override applied by ops → merchant order creation reflects new rate → Move guard accepts correct payment, rejects stale.
3. **Regression**
   - Ensure existing inbound flow, accounts module listeners, and Story 2.2/2.3 functionality unaffected (compare snapshot tests if available).

**Release Tasks**
- Tag contracts and services versions; update `CHANGELOG` or release notes.
- Coordinate deployment window: contracts → backend migrations → BFF services → frontend.
- Post-release monitoring: watch event listener lag, wallet errors, premium API logs.

---
## 9. Risk Matrix & Mitigation
| Risk | Area | Impact | Mitigation |
|------|------|--------|------------|
| Contract interface drift | Move modules | Medium | Enforce design sign-off, run integration tests pre-merge |
| Prisma migration conflicts | BFF | High | Lock schema branch, sequential migrations, use feature flag tables |
| Indexer rate limits | BFF listeners | Medium | Implement exponential backoff, track metrics |
| Wallet UX regressions | Frontend | Medium | Reuse existing guards, add Vitest coverage |
| Premium config race conditions | Move/BFF | Medium | Use versioned payloads, backend validation |
| Insurance claim & outbound dependency | Cross | High | Integration tests verifying guard interplay before release |

---
## 10. Next Steps
1. Review this implementation plan with engineering and product leads; capture feedback.
2. Approve contract changes & Prisma schema plan.
3. Schedule Milestone kickoff meetings and allocate owners.
4. Update story statuses and link subtasks to this plan.

---
## 11. Implementation Blueprint (Code Anchors)
```ts
/**
 * Epic 2.4–3.4 Delivery Blueprint
 * Author: Winston (Architect)
 * Format: machine-parseable plan for implementation tooling
 */
export const EpicPlan = {
  metadata: {
    epic: "2.4 + 3.x",
    scope: ["Move", "BFF/Indexer", "Frontend", "Shared", "Docs"],
    owners: {
      move: "chain-engineer",
      backend: "bff-engineer",
      frontend: "web-engineer",
      shared: "platform-shared",
      docs: "tech-writer"
    },
    timeline: [
      { milestone: "M0", label: "Design Sign-off", days: "Day 0-1" },
      { milestone: "M1", label: "Move Modules", days: "Day 2-5" },
      { milestone: "M2", label: "Shared Packages", days: "Day 4-6" },
      { milestone: "M3", label: "BFF/Indexer", days: "Day 6-11" },
      { milestone: "M4", label: "Frontend", days: "Day 9-14" },
      { milestone: "M5", label: "Docs & Ops", days: "Day 12-15" },
      { milestone: "M6", label: "E2E Release", days: "Day 15-17" }
    ],
    deploymentOrder: [
      "registry",
      "staking (3.1)",
      "orders update (2.4)",
      "insurance claims (3.3)",
      "insurance premium config (3.4)",
      "bff services",
      "frontend",
      "credit scheduler (3.2)"
    ]
  },

  stories: {
    "2.4": {
      title: "Fulfillment & Order Closure",
      anchors: {
        move: [
          "move/sources/orders.move::check_out => ensure insurance::assert_no_pending_claim + staking::assert_min_credit guards",
          "emit CheckedOut event with logistics_no, media_hashes, chain_timestamp",
          "update move/tests/orders_checkout_test.move for outbound scenarios"
        ],
        backend: [
          "apps/bff/prisma/schema.prisma::orders/order_events/order_media_assets => add outbound fields",
          "apps/bff/src/modules/orders/orders-event-listener.service.ts => ingest CheckedOut + media match state",
          "apps/bff/src/modules/orders/orders.controller.ts => expose outbound timeline, insurance block, media verify",
          "apps/bff/src/modules/orders/orders.service.ts => include fulfillment aggregate fields"
        ],
        frontend: [
          "apps/web/app/(warehouse)/orders/[recordUid]/check-out/page.tsx => outbound wizard entry",
          "apps/web/features/orders/outbound/* => reuse inbound components, hash validation, final timeline card",
          "apps/web/features/orders/outbound/__tests__/outbound-form.test.tsx => form validation + insurance block tests"
        ],
        shared: [
          "packages/shared/src/dto/orders.ts => outbound timeline DTO + insurance block flag",
          "packages/shared/src/config/aptos.ts => confirm module addresses after redeploy"
        ],
        docs: [
          "docs/runbook.md => add outbound QA checklist + insurance block resolution path",
          "docs/architecture/4-链下服务与数据流.md => confirm ingestion + API table"
        ]
      },
      dependencies: ["Story 3.3 (insurance guard) must expose assert_no_pending_claim API"]
    },

    "3.1": {
      title: "Staking Management Contract & Console",
      anchors: {
        move: [
          "move/sources/staking.move => StakeLedger, StakePosition, StakeChanged event, stake/unstake entry fns, view fns",
          "move/tests/staking_test.move => success/insufficient/locked/double stake coverage",
          "move/scripts/deploy_staking.sh => deploy after registry",
          "keep orders::assert_min_credit compatibility, notify Story 2.4 team if signature changes"
        ],
        backend: [
          "apps/bff/prisma/schema.prisma::StakingPosition/StakingEvent",
          "apps/bff/src/modules/staking/staking-event-listener.service.ts => poll StakeChanged",
          "apps/bff/src/modules/staking/staking.controller.ts => /api/staking endpoints",
          "apps/bff/src/modules/staking/staking.service.ts => ledger aggregation"
        ],
        frontend: [
          "apps/web/app/(dashboard)/warehouses/[address]/stake/page.tsx => console surface",
          "apps/web/features/staking/index.ts => cards, charts, stake/unstake modals",
          "apps/web/features/staking/__tests__/stake-flow.test.tsx => wallet interactions"
        ],
        shared: [
          "packages/shared/src/dto/staking.ts => stake summary/history DTOs",
          "packages/shared/src/config/aptos.ts => staking module address constants"
        ],
        docs: [
          "docs/runbook.md => staking reconciliation procedure update",
          "docs/architecture/3-链上合约设计.md => finalize staking module spec"
        ]
      },
      dependencies: ["Requires registry role definitions from Epic 1", "Must stay compatible with Story 2.4 guards"]
    },

    "3.2": {
      title: "Credit Scoring & Ranking",
      anchors: {
        backend: [
          "apps/bff/prisma/schema.prisma::CreditScore/CreditScoreLog/CreditWeightConfig",
          "apps/bff/src/modules/credit/credit.scheduler.ts => cron/interval recompute",
          "apps/bff/src/modules/credit/credit.service.ts => scoring model, audit trail",
          "apps/bff/src/modules/credit/credit.controller.ts => /api/credit-scores, /logs endpoints",
          "tests covering weight adjustments, missing data, recompute replay"
        ],
        frontend: [
          "apps/web/app/(dashboard)/credit/page.tsx => leaderboard entry",
          "apps/web/features/credit/components/*.tsx => score table, filters, trend drawer",
          "apps/web/features/credit/__tests__/credit-board.test.tsx"
        ],
        shared: [
          "packages/shared/src/dto/credit.ts => score DTOs, request params, weight config constants"
        ],
        docs: [
          "docs/runbook.md => credit recompute + replay procedure",
          "docs/architecture/4-链下服务与数据流.md => scoring pipeline diagram"
        ]
      },
      dependencies: [
        "Story 3.1: staking ingestion must be operational before scheduler run",
        "Story 2.4: order completion metrics required for fulfillment factor"
      ]
    },

    "3.3": {
      title: "Insurance Claims Process",
      anchors: {
        move: [
          "move/sources/insurance.move => Claim resource, open_claim/resolve_claim, ClaimOpened/ClaimResolved events, assert_no_pending_claim helper",
          "move/tests/insurance_test.move => duplicate, unauthorized, payout scenarios",
          "move/scripts/deploy_insurance.sh => deploy after orders"
        ],
        backend: [
          "apps/bff/prisma/schema.prisma::Claim/ClaimEvent/ClaimEvidence",
          "apps/bff/src/modules/claims/claim-event-listener.service.ts => sync events",
          "apps/bff/src/modules/claims/claim.controller.ts => /api/claims + approval actions",
          "apps/bff/src/modules/claims/claim.service.ts => transaction submit + retry",
          "integration tests: merchant submit → approval → data sync"
        ],
        frontend: [
          "apps/web/features/claims/apply/*.tsx => merchant flow (multi-step, evidence hash)",
          "apps/web/features/claims/ops/*.tsx => ops console (list, detail, approve/reject)",
          "apps/web/app/(warehouse)/orders/[recordUid]/claims/page.tsx",
          "apps/web/app/(ops)/claims/[claimId]/page.tsx",
          "tests for submit, approval guard, status timeline"
        ],
        shared: [
          "packages/shared/src/dto/claims.ts => claim DTOs, statuses, error codes"
        ],
        docs: [
          "docs/runbook.md => claims SOP (submit, approval, retry)",
          "docs/architecture/3-链上合约设计.md & 4-链下服务与数据流.md => update insurance module + API section"
        ]
      },
      dependencies: [
        "Expose assert_no_pending_claim for Story 2.4 guard",
        "Coordinate payout data with Story 3.2 scoring inputs"
      ]
    },

    "3.4": {
      title: "Insurance Premium & Validation",
      anchors: {
        move: [
          "Option A (on-chain): move/sources/insurance_config.move => rate resource + events",
          "Option B (off-chain): managed via BFF module; if chosen skip on-chain resource",
          "move/sources/orders.move => update create_order to read rate + assert premium sum",
          "move/tests/orders_premium_test.move => default/override/mismatch coverage"
        ],
        backend: [
          "If off-chain: apps/bff/prisma/schema.prisma::InsuranceRate/InsuranceRateHistory",
          "apps/bff/src/modules/insurance-rates/rates.controller.ts => /api/insurance/rates CRUD",
          "apps/bff/src/modules/insurance-rates/rates.service.ts => versioning + audit",
          "apps/bff/src/modules/orders/orders.service.ts => integrate rate fetch when building create_order payload",
          "tests for rate change → order validation"
        ],
        frontend: [
          "apps/web/features/orders/create/pricing-step.tsx => premium breakdown display + refresh prompt",
          "apps/web/hooks/useInsuranceRates.ts => query rates, handle version mismatches",
          "tests verifying default vs override flows"
        ],
        shared: [
          "packages/shared/src/dto/orders-pricing.ts => premium breakdown DTO",
          "packages/shared/src/config/insurance.ts => rate source metadata"
        ],
        docs: [
          "docs/runbook.md => rate change playbook (adjust → simulate order → verify)",
          "docs/architecture/3-链上合约设计.md => premium guard details",
          "docs/architecture/4-链下服务与数据流.md => rate ingestion/cache description"
        ]
      },
      dependencies: [
        "Story 3.3 insurance namespace must be finalized before config module",
        "Story 2.4 pricing DTO consumers must adopt new fields"
      ]
    }
  },

  crossCutting: {
    prismaMigration: {
      file: "apps/bff/prisma/schema.prisma",
      migrationName: "add-epic3-tables",
      models: [
        "Order (outbound extensions)",
        "OrderEvent",
        "OrderMediaAsset",
        "StakingPosition",
        "StakingEvent",
        "CreditScore",
        "CreditScoreLog",
        "CreditWeightConfig",
        "Claim",
        "ClaimEvent",
        "ClaimEvidence",
        "InsuranceRate (if off-chain)",
        "InsuranceRateHistory (if off-chain)"
      ]
    },
    sharedPackageHotspots: [
      "packages/shared/src/dto/orders.ts",
      "packages/shared/src/dto/staking.ts",
      "packages/shared/src/dto/credit.ts",
      "packages/shared/src/dto/claims.ts",
      "packages/shared/src/dto/orders-pricing.ts",
      "packages/shared/src/config/aptos.ts",
      "packages/shared/src/config/insurance.ts"
    ],
    documentationUpdates: [
      "docs/architecture/3-链上合约设计.md → add final Move module specs",
      "docs/architecture/4-链下服务与数据流.md → update ingestion, API tables, diagrams",
      "docs/detail/indexer-schema.md → confirm Prisma schema & cursors",
      "docs/front-end-spec.md → ensure new screens referenced",
      "docs/runbook.md → add outbound, staking, credit, claims, premium SOPs"
    ],
    testingMatrix: {
      move: ["aptos move test"],
      backend: ["npm run lint --workspace apps/bff", "npm run test --workspace apps/bff"],
      frontend: ["npm run lint --workspace apps/web", "npm run test --workspace apps/web"],
      integration: [
        "prisma migrate dev --schema apps/bff/prisma/schema.prisma",
        "scenario: outbound → claim block → resolve → reorder",
        "scenario: stake → credit recompute → leaderboard update",
        "scenario: rate change → order create → premium validation"
      ]
    },
    observability: {
      metrics: [
        "staking_event_lag_ms",
        "orders_checkout_ingest_lag_ms",
        "claims_sync_failures_total",
        "credit_recompute_duration_ms",
        "insurance_rate_version_skew_total"
      ],
      logging: "Follow existing Nest interceptors with request-id propagation"
    }
  }
} as const;
```
