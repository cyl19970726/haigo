# R1 Registration Success Redirect Plan

Goal: After a successful on-chain registration, automatically route users to their role-specific dashboard while keeping resilient fallbacks if indexing lags.

Owner: Web
Status: Draft

Milestones
1) Routes scaffolding
- Add Next.js pages/routes:
  - `/dashboard/seller` – basic shell, placeholder cards
  - `/dashboard/warehouse` – basic shell, placeholder cards
  - Both read-only for now (Epic 2 will populate real data)

2) Redirect implementation
- In `RegisterView`:
  - When `transactionState.stage === 'success'`, call `refreshAccountInfo()`.
  - If `accountInfo` is non-null and has role → `router.push(role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse')`.
  - Add 60s timeout fallback (show CTA buttons if delayed).
  - Announce via `aria-live` before redirect for accessibility.

3) Configuration tightening
- Require and validate at startup:
  - `NEXT_PUBLIC_APTOS_NETWORK`
  - `NEXT_PUBLIC_APTOS_MODULE`
  - If missing, show a non-blocking banner with remediation steps.

4) QA & validation
- Unit test: redirect decision logic by role
- Integration test: simulate success → refresh profile → expect router push
- Manual: mismatch network guard; slow indexer path (CTA fallback visible)

5) Docs & handoff
- Update `docs/front-end-spec.md` with redirect behavior (done)
- Update `docs/architecture/10-场景化端到端数据流.md` R1 section to include redirect (done)

Out of scope (later epics)
- Dashboard data widgets (orders, staking, alerts)
- Role-switching experience and permissions

