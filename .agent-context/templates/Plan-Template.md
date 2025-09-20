# Scenario Plan Template — Robust, Cross‑Layer Implementation

Use this template for new end‑to‑end scenarios (FE ↔ BFF ↔ DB ↔ Indexer/Fullnode ↔ Move). Keep it concise but complete. Fill every section; remove notes once finalized.

1) Goals & Deliverables
- Outcome in one sentence.
- User‑facing flows and technical deliverables (FE screens, APIs, DB models, listeners, scripts).

2) Cross‑Layer Design (Contracts & Flow)
- Sequence: FE → Wallet → Move → Indexer → Listener → DB → FE.
- Contracts: event types, DTOs, function args, query params.
- Linkage strategy: how client state (draft UID/nonce) maps to on‑chain artifacts.

3) Data Contracts
- DTO definitions (request/response), enums, error codes.
- Event payload schema with snake/camel aliases.
- Address normalization rules.

4) Database Schema & Migrations
- Models/tables, indexes, uniqueness, FKs.
- Migration files to add/modify tables.
- Cursor persistence table for listeners (e.g., `event_cursors`).

5) APIs (BFF)
- Endpoints list with methods, paths, inputs/outputs, status codes.
- Security (auth, rate limits, nonce/signature where applicable).
- Example payloads.

6) Listeners/Ingestion
- Upstream sources (Indexer GraphQL, Fullnode REST) and queries.
- Backoff policy (timeouts, 429), jitter, and page throttling.
- Cursor bootstrap strategy (latest vs. backfill offset) and persistence.
- Idempotency (unique keys, upserts) and merge rules.

7) Frontend Integration
- Routes/containers/components.
- Hooks and state management (draft creation, optimistic updates).
- URL query handling (e.g., `?warehouse=`) and persistence (session/local storage).

8) Configuration & Environments
- Env var list and precedence, e.g.:
  - `APTOS_INDEXER_URL`, `APTOS_NODE_API_URL`, `APTOS_NODE_API_KEY`.
  - Listener: `*_INTERVAL_MS`, `*_PAGE_SIZE`, `*_MAX_PAGES_PER_TICK`, `*_START_FROM_LATEST`, `*_BACKFILL_OFFSET_VERSIONS`.
  - Feature flags: `ENABLE_*`.
- Header policies (send both `x-aptos-api-key` and `Authorization: Bearer`).

9) Security
- Input validation, address format rules.
- Rate limiting and abuse prevention.
- Nonce/signature gating plan and staging.

10) Observability
- Metrics to expose (gauges/counters) and their semantics.
- Logs (levels, event IDs), error reporting, and alerting hooks.

11) Tests
- Unit: repositories, services, mappers, parser/normalizers.
- Integration: controller routes and listener side‑effects.
- E2E: user journey happy path + key failure modes.
- Test data, fixtures, and smoke scripts.

12) Acceptance Criteria
- Functional checks (what the user sees/gets).
- Quality gates (tests green, types clean, logs/metrics present).
- Documentation anchors updated.

13) Deployment & Rollback
- Rollout order (DB → BFF → FE → listeners).
- Feature flags and safe defaults.
- Rollback strategy and data compatibility.

14) Risks & Mitigations
- List top risks with mitigations and operational playbooks.

15) Anchors (Code Map)
- FE: file paths.
- BFF: modules, controllers, services, repositories, listeners.
- DB: schema/migrations.
- Move: relevant modules/functions/events.

16) Checklists
- Implementation Checklist
  - [ ] Schema & migration merged
  - [ ] APIs implemented & documented
  - [ ] Listener wired with persisted cursor
  - [ ] Pricing/data mapping verified
  - [ ] Security: validation + rate limits
  - [ ] Metrics & logs
  - [ ] Tests pass (unit/integration/E2E)
  - [ ] Docs anchors updated
- Preflight
  - [ ] Env vars present and consistent
  - [ ] Upstream API keys configured
  - [ ] Feature flags set as intended
- Post‑Deploy
  - [ ] Listener cursor advancing
  - [ ] Error counters stable
  - [ ] FE flow verified end‑to‑end

17) Open Questions
- List decisions still needed, with owners and due dates.

