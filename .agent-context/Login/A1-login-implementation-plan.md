# A1 – Wallet Connect Login & Landing

Status: In Progress
Owner: Web

Objectives
- Add a polished landing page with Login (Connect Wallet) and Register CTAs.
- Implement direct login by wallet connection; redirect by role when available.
- Document data-flow and acceptance criteria.

Deliverables
- FE routes/components: `apps/web/app/page.tsx` (Landing), reuse wallet context.
- Docs updated: `docs/front-end-spec.md`, `docs/architecture/10-场景化端到端数据流.md`, `docs/architecture/data-stream-login.md`.
- Plan & status updated under `.agent-context/`.

Scope & Tasks
1) UI (shadcn)
- Use Button, Card, Separator, Dialog, Toast for the landing page.
- Layout: hero with two primary CTAs + features grid.

2) Login behavior
- On connect success: check registration via `/api/accounts/:address`.
- If 200 → redirect to `/dashboard/{role}`; else → `/register`.

3) Optional session (future A2)
- Add nonce/sign-in challenge endpoints; set session cookie on success.

4) Testing
- Unit: role→path mapping; connect state transitions.
- Integration: mock 404→200 flow; redirect assertions.

Acceptance Criteria
- Landing renders with two CTAs and can connect wallet.
- Registered user lands on dashboard; unregistered goes to register.
- Docs contain diagrams and contracts; status updated.

Risks
- Wallet/network mismatch → use existing NetworkGuard and provide retry.
- Indexer lag → reuse 60s fallback CTA as in register flow.

Changelog
- 2025-09-19: plan created; docs updated; next step: implement landing page.

---

功能描述（What）
- 在首页提供“连接钱包登录”和“注册身份”两个主按钮：
  - 连接钱包后，若已注册（BFF 返回 200），自动跳转到 `/dashboard/{role}`；
  - 若未注册（BFF 返回 404），跳转至 `/register`；
  - 网络不匹配时提示并允许重试。
- 视觉与交互遵循 `docs/front-end-spec.md` 的首页规范，使用 shadcn 组件构建 Hero、按钮和功能卡片。

核心代码（Anchors & Snippets）
- 新增文件：`apps/web/app/page.tsx`
  ```tsx
  'use client';
  import { useEffect, useState } from 'react';
  import { useRouter } from 'next/navigation';
  import { useWalletContext } from '../lib/wallet/context';
  import { fetchAccountProfile } from '../lib/api/registration';
  import { Button } from '@/components/ui/button'; // shadcn

  export default function LandingPage() {
    const router = useRouter();
    const { status, accountAddress, availableWallets, connect } = useWalletContext();
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let mounted = true;
      async function check() {
        if (!accountAddress) return;
        setChecking(true);
        setError(null);
        try {
          const profile = await fetchAccountProfile(accountAddress);
          if (!mounted) return;
          if (profile) {
            router.push(profile.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse');
          } else {
            router.push('/register');
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Login failed.');
        } finally {
          setChecking(false);
        }
      }
      void check();
      return () => {
        mounted = false;
      };
    }, [accountAddress, router]);

    return (
      <main className="container mx-auto p-6">
        <section className="py-16 text-center">
          <h1 className="text-4xl font-bold">HaiGo</h1>
          <p className="mt-3 text-muted-foreground">Connect your wallet to continue</p>
          <div className="mt-8 flex gap-4 justify-center">
            {availableWallets.map(w => (
              <Button key={w.name} disabled={status==='connecting' || checking} onClick={() => connect(w.name)}>
                {status==='connecting' ? 'Connecting…' : `Connect ${w.name}`}
              </Button>
            ))}
            <Button variant="secondary" disabled={checking} onClick={() => router.push('/register')}>
              Register Identity
            </Button>
          </div>
          {error && <p role="alert" className="mt-4 text-destructive">{error}</p>}
        </section>
        {/* features grid cards … */}
      </main>
    );
  }
  ```
- 复用：`apps/web/lib/wallet/context.tsx`（连接状态）、`apps/web/lib/api/registration.ts`（查询注册）
- 路由锚点：
  - 已存在：`/register`、`/dashboard/seller`、`/dashboard/warehouse`
  - 新增：`/`（Landing）

相关文档（Docs）
- 设计规范：`docs/front-end-spec.md`（Homepage & Auth）
- 数据流：`docs/architecture/10-场景化端到端数据流.md`（A1 场景）、`docs/architecture/data-stream-login.md`
- 计划与状态：`.agent-context/AUTH/A1-login-implementation-plan.md`、`.agent-context/status.md`

验收标准（Acceptance Criteria）
1) 连接登录：
   - 未连接时显示钱包列表和“注册”按钮；
   - 连接后调用 `/api/accounts/:address`：
     - BFF 返回 200 → 2 秒内跳到 `/dashboard/{role}`；
     - BFF 返回 404 → 2 秒内跳到 `/register`；
2) 可达性：
   - 按钮有 aria labels；错误信息通过 `role="alert"` 呈现；
3) 视觉：
   - 使用 shadcn 的 Button/Card 等组件，布局符合规范；
4) 配置：
   - `apps/web/.env.local` 含 `NEXT_PUBLIC_APTOS_NETWORK`、`NEXT_PUBLIC_BFF_URL`；
5) 测试：
   - 单元测试覆盖地址→路径映射；
   - 集成测试覆盖 404→200 场景切换；
6) 文档：
   - 上述相关文档均存在且内容与实现一致。
