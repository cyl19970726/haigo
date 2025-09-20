# R1 Registration Success Redirect Plan (Detailed)

Goal
- After a successful on-chain registration, automatically route users to a role-specific dashboard, with robust fallback if indexing lags.

Owner
- Web (primary), BFF (support for consistent env + ingestion), Docs (alignment)

Status
- Draft → Ready for implementation

Scope (New Features + Modules)
1) Frontend routes (new)
- `/dashboard/seller` – seller workspace placeholder page
- `/dashboard/warehouse` – warehouse workspace placeholder page
- Shared dashboard shell (header, breadcrumbs, placeholders)

2) Registration success redirect (new)
- In `RegisterView`, auto-redirect based on role after:
  - transaction success, and
  - profile fetched from BFF returns non-null
- 60s timeout fallback with CTA buttons
- `aria-live=polite` announcement before redirect

3) Config banner (new, optional in this iteration)
- Non-blocking banner if critical env missing (`NEXT_PUBLIC_APTOS_MODULE`, `NEXT_PUBLIC_BFF_URL`)

4) Docs (updated)
- Architecture data-flow & R1 pitfalls (done)
- Frontend spec for redirect (done)
- New `docs/architecture/data-stream.md` for E2E traces (added)

Design Details (Core Anchor Code)
- File anchors (to be edited):
  - `apps/web/features/registration/RegisterView.tsx`: add redirect effect after success
    - Hook: useEffect on `[transactionState.stage, accountInfo?.role]`
    - Pseudocode:
      ```tsx
      const router = useRouter();
      useEffect(() => {
        if (transactionState.stage !== 'success') return;
        const timer = setTimeout(() => setShowCta(true), 60000);
        if (accountInfo?.role) {
          const path = accountInfo.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse';
          announce('Registration succeeded, redirecting to your dashboard…');
          router.push(path);
        }
        return () => clearTimeout(timer);
      }, [transactionState.stage, accountInfo?.role]);
      ```
  - New pages:
    - `apps/web/app/dashboard/seller/page.tsx`
    - `apps/web/app/dashboard/warehouse/page.tsx`
    - Both render simple placeholders and read-only role-aware copy

Coordination with Other Modules
- BFF
  - Ensure `.env.local` has `NEXT_PUBLIC_APTOS_MODULE` after deploy (script writes this)
  - R1 listener continues to ingest on 30s interval; for slower rollups, FE will retry and provide 60s timeout CTA
- Move
  - Registry register_* entry functions must succeed (already deployed)
- Web/Wallet
  - Network guard must indicate Testnet; wrong network → no submit; already handled

Risks & Mitigations
- Indexer lag → redirect never fires
  - Mitigation: 60s timeout CTA; keep success state visible with explorer link; allow manual dashboard navigation
- Env drift (missing NEXT_PUBLIC_APTOS_MODULE)
  - Mitigation: config banner; deployment script maintains `.env.local`
- Route not found
  - Mitigation: create minimal `/dashboard/*` pages before wiring redirect

Acceptance Criteria
1) Success path
- After signing and confirmation, FE redirects to `/dashboard/{role}` within 0–60s (typically <10s)
- If BFF returns 404 for <60s, FE stays and retries; redirect after 200 response
2) Slow path
- >60s without profile → show CTA buttons: “Go to dashboard” and “Refresh status”
3) Accessibility
- `aria-live` message published prior to redirect
4) Config
- Missing required env triggers non-blocking banner with remediation steps

Testing Plan
- Unit: redirect decision util (role → path); timeout logic
- Integration: mock wallet success → mock profile 404→200 → expect router.push
- E2E (optional): simulate register on Testnet small account, observe UI flow

Implementation Steps
1) Create two dashboard pages under `apps/web/app/dashboard/`
2) Add redirect useEffect to `RegisterView`
3) Add optional config banner component (reads env via NEXT_PUBLIC_*)
4) Add tests (unit + integration)
5) Update docs (already added; verify links)

Timeline & Owners
- Day 1: Routes scaffolding & redirect logic
- Day 2: Tests & polish (accessibility, CTA timeout)

Out of scope
- Real dashboard widgets (Epic 2+)
