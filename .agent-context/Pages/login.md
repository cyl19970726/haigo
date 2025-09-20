# login.md — Dedicated Login Screen & Public Home Refactor Plan

## Context Recap
- The landing page (`apps/web/app/page.tsx`) currently owns wallet connection, registration polling, and session bootstrapping. Network mismatches surface through `NetworkGuard`, which can hide the UI entirely.
- The registration flow (`RegisterView`) already demonstrates the desired wallet interaction model built on `useWalletContext`, `useAccountRegistration`, `ensureSession`, and the Aptos wallet adapter.
- We need a first-class `/login` route that mirrors registration behaviour, while keeping `/` strictly public marketing content.
- Aptos MCP reference: `how_to_integrate_wallet_selector_ui` documents selector expectations; ensure our UI remains conformant.

## Work Breakdown Structure

### Phase 0 — Prerequisites & Alignment
1. **Review shared wallet utilities** (`apps/web/lib/wallet/context.tsx`, `apps/web/lib/wallet/network.ts`, `apps/web/lib/wallet/network-guard.tsx`). Confirm the in-progress normalization changes from `fix-login.md` are merged or queued in the same branch.
2. **Audit session hooks** (`useAccountRegistration`, `useAuthSession`, `ensureSession`) to determine which pieces move into the login view vs. remain shared. Capture any missing typings or reused copy.
3. **Validate environment config** to ensure `NEXT_PUBLIC_APTOS_NETWORK` and related vars exist in `.env.local` so the new login screen behaves deterministically.

### Phase 1 — Extract Login Experience
1. **Create feature module** `apps/web/features/auth/LoginView.tsx`:
   - Port wallet/session logic from `app/page.tsx`, adapting component state to the new file structure.
   - Maintain the `NetworkGuard` wrapper but reuse the improved fallback (show connect controls + `refreshNetworkStatus`).
   - Ensure the wallet selector CTA follows register view button ordering and leverages guidance from Aptos MCP (multi-wallet list, connect, disconnect, retry actions).
   - Factor out repeated copy (error messages, status captions) into shared helper constants if both login and register need them.
2. **Supportive assets**:
   - Add index barrel (`apps/web/features/auth/index.ts`) if necessary for tidy exports.
   - Reuse existing CSS utility classes; only create new styles when unavoidable.

### Phase 2 — Wire the Route
1. **Define `/login` page** at `apps/web/app/(auth)/login/page.tsx` rendering `<LoginView />`.
2. **Add metadata** (`generateMetadata` or static export) to describe “Login | Haigo Platform” for parity with register page.
3. **Update navigation** components (e.g., `apps/web/components/layout/Header.tsx` if present) so login links point to `/login` instead of `/`.

### Phase 3 — Refactor Home Page
1. **Simplify `apps/web/app/page.tsx`**:
   - Remove wallet hooks, state, and network guards.
   - Preserve marketing hero/value content; convert CTA buttons to router links pointing at `/login` and `/register`.
   - Optionally display a read-only badge showing `NEXT_PUBLIC_APTOS_NETWORK` for transparency without wallet coupling.
2. **Confirm imports**: eliminate unused wallet-related imports and hooks.
3. **Content review**: ensure copy still invites users to log in/register without implying wallet presence on the homepage.

### Phase 4 — Cross-Cutting Updates
1. **Shared copy**: consolidate error/status messages between login/register into a shared module if duplication occurs after extraction.
2. **Docs**: update `.agent-context/Pages/Home.md` (and any README/runbook entries) to describe the new navigation structure and login page ownership.
3. **QA alignment**: note in `fix-login.md` progress that the login plan now expects relaxed network matching plus visible controls.

### Phase 5 — Validation & Release Prep
1. **Unit tests**: extend or create tests for any new helpers (e.g., network label formatting, login state reducers) under `apps/web/features/auth/__tests__` if logic warrants.
2. **Manual QA** (desktop + mobile viewport):
   - `/` loads without wallet prompts; CTAs route correctly.
   - `/login` handles wallet connect/disconnect, network mismatch fallback, backend outage messaging, and redirects to role dashboards upon successful verification.
   - `/register` flow remains unchanged and still funnels into the same session pipeline; confirm navigation between register and login works.
3. **Regression sweep**: run existing lint/test scripts (`pnpm lint`, `pnpm test --filter web`) to catch integration breaks.
4. **Deploy notes**: document in the branch PR what requires retesting in production (wallet providers, BFF availability).

## File Change Map (Expected)
- `apps/web/features/auth/LoginView.tsx` — new login component.
- `apps/web/features/auth/index.ts` (optional) — re-export convenience.
- `apps/web/app/(auth)/login/page.tsx` — new route entry.
- `apps/web/app/page.tsx` — stripped down marketing home.
- `apps/web/components/layout/Header.tsx` or similar — navigation adjustments.
- `.agent-context/Pages/Home.md` — documentation refresh.
- Potential shared constants file for login/register copy (e.g., `apps/web/features/auth/constants.ts`).

## Risk Notes
- Wallet adapter changes can regress register flow; mitigate by ensuring both screens consume the same shared helpers.
- NetworkGuard UX must be finalized alongside this work; coordinate merging to avoid inconsistent fallbacks.
- Ensure no SSR guard depends on the root page for session bootstrap; dashboard layout should continue to gate access via cookies.

## Execution Checklist
- [ ] Confirm network normalization updates from `fix-login.md` are in place or queued with this branch.
- [ ] Stand up `LoginView` with wallet connection, registration polling, and session verification mirrored from the old home page.
- [ ] Route `/login` to `LoginView` with appropriate metadata and navigation links updated.
- [ ] Refactor `/` to static marketing content with CTAs linking to `/login` and `/register`.
- [ ] Sync shared copy/constants between login and register to avoid divergence.
- [ ] Refresh documentation (`Home.md`, additional runbooks) to describe the new flow.
- [ ] Run lint/tests and complete manual wallet QA scenarios (testnet, mismatched network, backend offline).
- [ ] Capture release notes / PR summary outlining required verification steps post-deploy.

