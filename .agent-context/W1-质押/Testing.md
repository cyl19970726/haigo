# W1 Real-Network Integration Test Guide (Testnet)

Purpose
- Validate warehouse staking (stake/unstake) and storage fee updates on Aptos testnet across FE ↔ BFF ↔ Move.
- Provide precise steps for agent + Playwright MCP to execute and assert results.

Outcomes
- Frontend shows updated staked amount and fee within seconds after confirmed transactions.
- BFF returns data from on-chain views (meta.source=onchain) and exposes listener metrics.
- Move emits events; optional: listener metrics reflect event ingestion progress.

---

1) Prerequisites
- OS: macOS/Linux (Windows WSL is fine)
- Tools:
  - Node ≥ 18, pnpm ≥ 8.15
  - Aptos CLI + jq (for deploy and view)
  - Postgres (local or Docker) and optional Hasura
  - Browser with Aptos wallet extension (Petra/Martian) for manual UI signing
- Network:
  - Aptos testnet (Aptos Labs gateway)

2) Environment Setup
- For baseline env files and Docker bootstrap, follow **docs/architecture/6-部署与环境.md** (same setup used by L1 Directory tests).
- Install dependencies:
  - `pnpm install`
- Configure .env files (root and web):
  - Root `.env.local` (used by BFF/scripts) — minimal:
    - `APTOS_INDEXER_URL=https://api.testnet.aptoslabs.com/v1/graphql`
    - `APTOS_NODE_API_URL=https://api.testnet.aptoslabs.com/v1`
    - Optional: `APTOS_NODE_API_KEY=aptoslabs_...`
    - `DATABASE_URL=postgres://haigo:haigo@localhost:5433/haigo`
  - Web `apps/web/.env.local` — minimal:
    - `NEXT_PUBLIC_BFF_URL=http://localhost:3001`
    - `NEXT_PUBLIC_APTOS_NETWORK=testnet`
    - `NEXT_PUBLIC_APTOS_MODULE=0x<after-deploy>`
    - `NEXT_PUBLIC_APTOS_ORDERS_MODULE=0x<after-deploy>`
- Start Postgres (Docker, optional):
  - `docker compose -f docker/compose.poc.yml up -d`
- Quick launch (separate terminals) once env is ready:
  ```bash
  pnpm --filter @haigo/shared build --watch
  pnpm --filter @haigo/bff build && pnpm --filter @haigo/bff start
  pnpm --filter @haigo/web dev
  ```

3) Deploy Move to Testnet (one-time per profile)
- Command (uses scripts/deploy_aptos_testnet.sh):
  - `pnpm deploy:testnet`
  - or: `bash scripts/deploy_aptos_testnet.sh haigo-testnet`
- Script does:
  - Initializes/funds profile, publishes Move with named address `haigo=<account>`
  - Runs `init_registry_entry`, `init_orders_entry` and `orders::configure`
  - Updates root `.env.local` and `apps/web/.env.local` with `NEXT_PUBLIC_APTOS_MODULE=<account>`
- Initialize staking module (idempotent):
  - `aptos move run --profile haigo-testnet --assume-yes --function-id "<ACCOUNT>::staking::init_staking_entry"`
- Verify env has been updated:
  - `grep NEXT_PUBLIC_APTOS_MODULE .env.local apps/web/.env.local`

4) Database Migration & Build
- `export DATABASE_URL="postgres://haigo:haigo@localhost:5433/haigo"`
- `pnpm --filter @haigo/bff prisma generate`
- `pnpm --filter @haigo/bff prisma migrate dev -n add_staking_tables`
- `pnpm --filter @haigo/shared build`

5) Run Services
- BFF: `pnpm --filter @haigo/bff build && pnpm --filter @haigo/bff start`
- Web: `pnpm --filter @haigo/web dev`
- Health checks:
  - GET `http://localhost:3001/metrics` → contains `order_listener_*` and `staking_listener_*` lines
  - GET `http://localhost:3001/api/staking/0x<warehouse>` → JSON envelope with `meta.source`

6) Wallet Preparation (FE signing path)
- Install Aptos wallet extension (Petra/Martian)
- Import the same testnet account used during deployment (address = `NEXT_PUBLIC_APTOS_MODULE`)
- Ensure wallet network set to Testnet

7) FE E2E Flow (Playwright MCP scriptable)
- Navigate to `http://localhost:3000/(warehouse)/staking`
- If wallet disconnected:
  - Expected: page displays `Please connect your wallet to view staking.`
  - Action (manual or automated with wallet automation): click Connect Wallet in the app shell, pick your wallet, approve connection
- Once connected and page visible:
  - Expected baseline (values may be 0 if new account):
    - Staked Amount: numeric string (subunits)
    - Storage Fee: bps integer (e.g., 25)

- Stake
  1) Input `Amount (APT)` = `0.10`
  2) Click `Stake`
  3) Wallet popup: approve transaction
  4) UI shows `Submitting transaction…` then `Txn: <hash>`
  5) Wait 5–15s for confirmation; click `Refresh`
  6) Expected: `Staked Amount` increased by `10,000,000` (0.10 APT × 10^8 subunits)
  7) BFF API check (optional):
     - `curl -s "http://localhost:3001/api/staking/<ACCOUNT>" | jq`
     - Expected: `meta.source = "onchain"` and `data.stakedAmount` reflects new value

- Set Storage Fee
  1) Input `Storage Fee (bps)` = `35`
  2) Click `Set Storage Fee`
  3) Approve wallet popup
  4) Wait 5–15s; click `Refresh`
  5) Expected: `Storage Fee = 35`

- Unstake (valid)
  1) Input `Amount (APT)` = `0.05`
  2) Click `Unstake` and approve
  3) Wait; click `Refresh`
  4) Expected: `Staked Amount` decreased by `5,000,000`

- Unstake (invalid)
  1) Input `Amount (APT)` greater than currently staked amount
  2) Click `Unstake`; approve
  3) Expected: wallet reports transaction abort (E_INVALID_AMOUNT); page shows an error message in the actions area (`role=alert`)

8) API-only Validation (no wallet automation required)
- Using Aptos CLI (reads on-chain views):
  - `aptos view --profile haigo-testnet --function-id "<ACCOUNT>::staking::get_stake" --args "address:<ACCOUNT>"`
  - `aptos view --profile haigo-testnet --function-id "<ACCOUNT>::staking::get_storage_fee" --args "address:<ACCOUNT>"`
  - Expected: JSON arrays with a single numeric value each

- Using BFF REST (onchain preferred; cache fallback):
  - `curl -s "http://localhost:3001/api/staking/<ACCOUNT>" | jq`
  - Expected:
    - `data`: `{ warehouseAddress, stakedAmount: string, minRequired: "0", feePerUnit: number }`
    - `meta`: `{ source: "onchain" | "cache" }`

9) Listener Metrics Validation (optional)
- Generate at least one stake or fee update to emit events
- Open `http://localhost:3001/metrics`
- Expected lines:
  - `staking_listener_last_version <number>`
  - `staking_listener_error_total <number>`
- If last_version remains 0, check envs:
  - `APTOS_INDEXER_URL` points to Aptos Labs GraphQL
  - `NEXT_PUBLIC_APTOS_MODULE` equals your deployed module address

10) Troubleshooting
- `NEXT_PUBLIC_APTOS_MODULE` missing → UI actions throw error; set and restart
- View calls show `meta.source=cache`:
  - Ensure `APTOS_NODE_API_URL` reachable; set `APTOS_NODE_API_KEY` if required
- Stake/Unstake no effect:
  - Wait and Refresh; confirm hash on explorer; use Aptos CLI view to verify on chain state
- Metrics not updating:
  - Listener uses Indexer GraphQL; ensure `APTOS_INDEXER_URL` correct and module address set

11) Clean Up (optional)
- Unstake to reduce state for repeated tests
- Stop Docker environment:
  - `docker compose -f docker/compose.poc.yml down --remove-orphans`

Appendix A – Quick Commands
- Deploy and init staking:
  - `pnpm deploy:testnet`
  - `aptos move run --profile haigo-testnet --assume-yes --function-id "<ACCOUNT>::staking::init_staking_entry"`
- Prisma & run:
  - `export DATABASE_URL="postgres://haigo:haigo@localhost:5433/haigo"`
  - `pnpm --filter @haigo/bff prisma migrate dev -n add_staking_tables`
  - `pnpm --filter @haigo/shared build`
  - `pnpm --filter @haigo/bff build && pnpm --filter @haigo/bff start`
  - `pnpm --filter @haigo/web dev`

Appendix B – Playwright MCP Hints
- Wallet popups require extension automation; if not available:
  - Pre-execute stake/unstake via Aptos CLI (same account) and only assert FE values (connect wallet first or adjust tests to call BFF API directly)
- Stable selectors:
  - Section heading `id="staking-heading"`
  - Buttons: text `Stake`, `Unstake`, `Set Storage Fee`, `Refresh`
  - Inputs: labeled `Amount (APT)`, `Storage Fee (bps)`
- Assertions:
  - Expect visible text updates after `Refresh`
  - Expect error alert exists when invalid unstake occurs
