# A2 – Product Homepage (UX/UI) Plan

Status: Planned
Owner: Web + UX

Objectives
- Deliver a visually compelling, product-focused homepage that clearly communicates HaiGo’s value (verifiable storage/logistics for cross‑border commerce), and drives conversion to Connect Wallet (Login) or Register.
- Ensure responsive, accessible, performant implementation using shadcn components and existing wallet flow.

Feature Description (What)
- Hero section: bold headline, supporting copy, primary CTA (Connect Wallet), secondary CTA (Register), trusted badges/logos.
- Value props grid: 3–6 cards highlighting benefits (Verifiable Storage, Transparent Logistics, Insurance & Claims, Indexer‑backed Proofs, Low Friction Onboarding, Analytics).
- How it works (4 steps): Connect → Register → Create Order → Track & Verify.
- Proof/Social: metrics band (orders processed, storage partners), testimonials (optional), logos (optional).
- Single CTA set: only in the Hero (remove repeated final CTA band to avoid duplication).
- Footer: links to Docs, Privacy, Contact.

Scope & Tasks
1) UX/UI Design Specs
- Typography scale, spacing, colors (light/dark), cards and iconography usage.
- States: loading (connecting…), error, empty.
- Motion: subtle fade/slide on hero and cards; reduced‑motion safe.

2) Components (shadcn)
- Button, Card, Badge, Separator, Tabs (optional), Dialog (tips), Toast (feedback), Sheet/Navbar (mobile).
- Theming: CSS variables for brand colors; respect prefers‑color‑scheme.

3) Implementation
- Update `apps/web/app/page.tsx` to A2 layout (hero + sections) using shadcn components.
- Keep A1 logic (connect → route by registration status; Register CTA → /register).
- Add simple responsive layout (container max‑width, grid breakpoints).

4) Content & Copy
- Headline: “Verifiable storage and logistics for cross‑border commerce.”
- Subcopy: Emphasize indexer‑backed proofs, transparent fees, reliable partners.
- Buttons: “Connect Wallet” (primary), “Register Identity” (secondary).

5) Accessibility & Performance
- aria‑labels, aria‑live on connection states, keyboard focus ring.
- LCP target: hero text; avoid large blocking images.

6) Testing & QA
- Visual regression (critical sections), responsive breakpoints.
- A11y: keyboard navigation, contrast, announcements.
- Integration: connect flow still routes correctly by status.

Core Anchor Code
- `apps/web/app/page.tsx` – homepage layout and CTAs
- `apps/web/components/ui/*` – shadcn wrappers (Button/Card/Badge…)
- `apps/web/lib/wallet/context.tsx` – connect state
- `apps/web/lib/api/registration.ts` – registration check

Documentation
- Update `docs/front-end-spec.md` with A2 “Homepage V2” specs and ASCII layout.
- No data‑flow changes beyond A1; cross‑link to `docs/architecture/data-stream-login.md`.

Acceptance Criteria
1) Visual completeness: all sections present (Hero, Value, How‑it‑works, CTA, Footer) and responsive.
2) Conversion: primary CTA connects wallet and routes by registration status; secondary CTA goes to /register.
3) A11y: keyboard navigable; assistive announcements on connect; contrasts meet WCAG AA.
4) Perf: no CLS on initial render; LCP within target on dev hardware.
5) Docs updated: front‑end spec section present with ASCII wireframe.

Timeline
- Day 1: Layout scaffolding with shadcn components; copy placeholders.
- Day 2: Visual polish, responsiveness, a11y pass, doc updates.
