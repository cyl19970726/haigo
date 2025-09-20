# L1 Directory Integration Playbook

> Scope: Validate the “Warehouse Directory” (L1) flow across BFF `/api/warehouses`, Hasura enrichment, cache behaviour, and the seller UI at `/(seller)/warehouses` → O1 hand-off.

---

## 1. Prerequisites
- Follow **docs/architecture/6-部署与环境.md** for baseline environment variables, Postgres/Hasura bootstrap, and Move deployment (W1 staking cache must be populated by the listener).
- Toolchain
  - Node ≥ 18, pnpm ≥ 8.15 (`pnpm install` at repo root once).
  - Docker (optional) for `docker/compose.poc.yml` stack (Postgres + Hasura).
  - Aptos CLI (only required if you need to backfill staking/storage fee data manually).
- Data readiness
  - Ensure W1 ingestion is running (staking listener) so that `staking_positions` / `storage_fees_cache` tables have entries. You can seed manually using Aptos CLI staking transactions if needed.

## 2. Launching the stack
```bash
# Terminal 1 – shared build (optional but keeps types fresh)
pnpm --filter @haigo/shared build --watch

# Terminal 2 – BFF (runs on :3001)
pnpm --filter @haigo/bff build && pnpm --filter @haigo/bff start

# Terminal 3 – Web (Next dev server on :3000)
pnpm --filter @haigo/web dev
```
Tips
- Both apps pick up env from repo root `.env.local` and `apps/web/.env.local` (see docs/architecture/6 for templates).
- If you prefer Docker for Postgres/Hasura: `docker compose -f docker/compose.poc.yml up -d` before starting services.

## 3. API verification checklist
1. **Warm cache hit**
   ```bash
   curl -s "http://localhost:3001/api/warehouses" | jq
   ```
   - Ensure response is JSON envelope `{ data, meta }`.
   - `meta.cacheHit` should be `false` on first call and `true` immediately after repeating the command within 30s.
2. **Filter & pagination**
   ```bash
   curl -s "http://localhost:3001/api/warehouses?available=true&minScore=60&maxFeeBps=50&area=north-china&page=1&pageSize=12" | jq
   ```
   - Expect only warehouses matching the filters.
   - Verify `meta.page`, `meta.pageSize`, and `meta.total`.
3. **Hasura fallback**
   - Temporarily stop Hasura (`docker stop haigo-hasura`) and repeat call.
   - API should still return data (without service area/credit extras), BFF logs warning, and `meta.cacheHit` resets.
   - Restart Hasura afterwards.
4. **Metrics** – inspect `http://localhost:3001/metrics` for new counters:
   - `directory_request_total`, `directory_cache_hit_total`, `directory_error_total`, `directory_request_latency_ms`.

## 4. Frontend smoke (Seller Directory)
1. Browse to `http://localhost:3000/warehouses` (app shell under `(seller)` segment).
2. Validate UI states:
   - Loading skeleton → filter card.
   - With data: cards show name, availability badge, staking score, capacity, fee %, last audit date, service areas.
   - Empty state appears when filters are restrictive.
3. Exercise filters/pagination:
   - Type query, adjust min score / max fee, toggle availability.
   - Ensure footer’s total count & page indicator update.
4. CTA → O1 bridge:
   - Click “Select warehouse”.
   - Confirm navigation to `/orders/new?warehouse=0x...` and `CreateOrderView` preselects the same warehouse in the stepper.

## 5. Manual cache validation (optional deeper dive)
- Trigger list call with `pageSize=200` to stress memory cache and ensure TTL works (set `DIRECTORY_CACHE_TTL_MS` in env to shorten if needed).
- From BFF logs (stdout) confirm `Directory cache refresh` / `Directory cache hit` entries align with expectations.

## 6. Regression pointers
- Run automated suites before handing off:
  ```bash
  pnpm --filter @haigo/bff test
  pnpm --filter @haigo/web test -- --run
  ```
- Verify W1 listener metrics still healthy (`staking_listener_last_version` advancing) since L1 depends on those tables.

## 7. Troubleshooting quick answers
| Symptom | Checks |
| --- | --- |
| `/api/warehouses` returns empty | Confirm `staking_positions` / `storage_fees_cache` have rows, and `accounts` table has warehouse entries (W1 ingestion). |
| FE shows “Error loading directory” | Look at BFF logs; Hasura may be down or env misconfigured (`HASURA_URL`, `HASURA_ADMIN_SECRET`). |
| CTA does not preselect warehouse | Ensure URL carries `?warehouse=`; verify `CreateOrderView` fetched warehouses successfully (network tab, console). |
| CORS errors | Confirm `BFF_CORS_ORIGINS` includes `http://localhost:3000` (default does). |

## 8. Reporting
- Capture: curl output (`meta` block), screenshot of UI filters & cards, metrics snippet.
- File issues with precise filter combo, timestamps, and whether cacheHit was true/false.

Happy testing!
