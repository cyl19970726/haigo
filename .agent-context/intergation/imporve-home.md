# improve-home plan

> Deliver HaiGo landing page that mirrors the provided minimalist hero screenshot while wiring in existing wallet login/register logic.

## 1. Visual & UX Direction
- Single-column, center-aligned hero with generous vertical rhythm and no secondary sections.
- Palette anchored on soft aqua blues (`#40879D`, `#5795A9`) against a misty white backdrop `#F3F7F8` plus a light footer ribbon.
- Typography stack: ship icon → "HaiGo" wordmark → slogan (`让物流更自由`) → English strapline → bold Chinese value proposition.
- Add status feedback as subtle pills below CTAs so wallet/session states remain visible without cluttering the hero.

## 2. Key Elements (match screenshot)
1. **Top Badge** – Right-aligned pill `基于Aptos的海外仓RWA平台` with sparkle icon.
2. **Logo Stack** – Circular gradient tile containing ship icon, `HaiGo` wordmark, slogan.
3. **English Strapline** – Exact sentence from reference image describing warehousing solution.
4. **Primary Headline** – Chinese statement `为跨境电商卖家提供可信、可用的分布式仓储物流解决方案`.
5. **Action Row** – Buttons: primary `连接钱包登录` (reuses wallet connect/session flow), secondary `注册`, optional `断开连接` & `重试查询` per state.
6. **Status Pills** – Dynamic chips mirroring registration/checking/errors (wallet missing, backend unreachable, signing progress, etc.).
7. **Feature Pills** – Three rounded chips with icons: `RWA`, `区块链`, `共享经济`.
8. **Footer Ribbon** – Light blue band containing `© 2025 HaiGo · Web3 Logistics Network`.

## 3. Styling Updates (`apps/web/app/globals.css`)
- Refresh root tokens: `--bg`, `--foreground`, `--primary`, `--secondary` etc. to new blue scheme; mirror equivalents for dark mode.
- Add new helpers: `.home-page`, `.home-shell`, `.home-topline__badge`, `.home-brand__*`, `.home-actions`, `.home-status`, `.home-chip`, `.home-footer`, including pill variants for error/success states.
- Remove legacy A2 sections (`landing-hero`, `value-grid`, `metrics-band`, etc.) since layout is now hero-only.

## 4. Page Refactor (`apps/web/app/page.tsx`)
- Keep existing wallet/session hooks (`useWalletContext`, `useAccountRegistration`, `ensureSession`).
- Convert copy and runtime messages to Chinese where surfaced in UI (connect labels, lookup messages, session captions, errors).
- Build `statusPills` array to aggregate lookup/session/backend messages and render them as `.home-status__pill` with tone modifiers.
- Render hero structure per section list; map feature pills from icon descriptor array using `lucide-react` icons (`ShieldCheck`, `Globe2`, `Share2`).
- Remove aggressive `NetworkGuard` gating from the landing page; surface any wallet/network issues only via status pills so the hero never blocks rendering.

## 5. Accessibility & Responsiveness
- `home-status` container exposes `aria-live="polite"` for dynamic status updates.
- Buttons remain keyboard reachable; ghost buttons only appear when relevant.
- Mobile breakpoint reduces padding, clamps title sizes, and lets badge/cta/pills wrap.
- Single light theme only; no alternate dark background so experience remains consistent regardless of system preference.

## 6. Verification & Follow-up
- Manual QA: wallet missing flow, connect + register detection, disconnect, network mismatch fallback.
- Visual QA: compare against provided screenshot, ensure Chinese copy matches exactly, chips align center.
- Post-merge: update `docs/architecture/5-前端体验.md` screenshots/copy to reflect new hero when ready.
