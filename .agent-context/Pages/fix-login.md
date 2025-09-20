# fix-login.md — Homepage Wallet Login & Redirect Plan

## 1. 当前登录流程全貌

整理所有前端相关文件，梳理“连接钱包→签名→跳转 Dashboard”链路：

- `apps/web/lib/wallet/context.tsx`
  - 基于 `@aptos-labs/wallet-adapter-react` 封装 WalletContext。
  - 维护 `status / accountAddress / walletName / networkStatus` 等状态。
  - `computeNetworkStatus()` 将 `network?.name` 归一化为小写；`expected` 取自 `NEXT_PUBLIC_APTOS_NETWORK`（默认 `testnet`）。
  - `refreshNetworkStatus()` 只是重新读取 `network?.name` 并更新状态。

- `apps/web/lib/wallet/network-guard.tsx`
  - 每次渲染都会调用 `refreshNetworkStatus(2)` 并监听 `window.focus`。
  - 当 `networkStatus.isMatch` 为 false 时渲染 fallback，提示“Switch to {expected}”。

- `apps/web/lib/hooks/useAccountRegistration.ts`
  - 轮询 BFF `/api/accounts/:address`，确认该地址是否已注册。

- `apps/web/lib/hooks/useAuthSession.ts`
  - 新增的状态机 Hook：`idle → requesting_challenge → awaiting_signature → verifying → verified/error`。
  - 内部调用 `ensureSession(address, signMessage, fallbackPublicKey, callbacks)`。

- `apps/web/lib/session/ensureSession.ts`
  - 调用 `/api/session/challenge` 获取 challenge。
  - 触发钱包 `signMessage`，如钱包未返回 `publicKey` 则回退到 `accountPublicKey`。
  - 调用 `/api/session/verify`（现在 BFF 会返回 `{ profile, sessionId }`）。
  - 将 `sessionId` 传给本地 dev API `/api/dev/session/sync` 写入同域 HttpOnly Cookie；失败时降级 document.cookie。
  - 返回最新 profile。

- `apps/web/app/page.tsx`
  - Hero 区现已与注册页一致：每个钱包一个按钮（`Connect {wallet}`），显示 `Disconnect`。
  - 通过 `useAuthSession` 管理登录签名，成功后跳转 `/dashboard/{role}`。
  - NetworkGuard 若检测到网络不匹配，则直接显示 fallback，并阻止后续流程。

- `apps/web/app/dashboard/layout.tsx`
  - SSR 守卫：读取 Cookie（通过 `loadSessionProfileFromServer()`），若无则 `redirect('/')`。

- 后端接口
  - `apps/bff/src/modules/auth-session/auth-session.controller.ts` / `auth-session.service.ts`
    - `/api/session/challenge` / `/api/session/verify` / `/api/session/profile`
    - verify 支持 fullMessage（与 Aptos Signed Message 规范一致），返回 sessionId。
  - Event listener / Prisma Cursor 需数据库迁移（`event_cursors`）。

## 2. 现存问题 & 根因

### 2.1 NetworkGuard 总是提示 “Switch to testnet”

- `networkStatus.actual` 仅取 `wallet.network?.name`，然后 `toLowerCase()`。
- 多数钱包（Petra/Martian）返回的 name 可能是 `"Aptos Testnet"` 或 `"Aptos/ testnet"`，与预期 `"testnet"` 不完全等同。
- `computeNetworkStatus()` 未做映射或模糊匹配，导致 `isMatch=false`。
- 结果：`NetworkGuard` 永远渲染 fallback，后续按钮虽可点击，但更早就被“切网络”提示覆盖，用户误认为无法连接。

### 2.2 BFF 未启动造成登录流程无法继续

- `/api/session/challenge` / `/api/session/verify` 依赖 BFF；未启动时出现 `fetch failed`。
- 首页现在的错误提示虽会显示“Retry login”，但如果 NetworkGuard fallback 挡住或用户没有看到详细信息，就误以为“Connect Wallet 没反应”。

### 2.3 流程兼容性

- 目前首页和注册页已经共享 `useAuthSession` / `ensureSession`。注册页看起来“正常”是因为它让用户先连接钱包，之后才在提交注册时触发签名。
- 首页现在与注册页 UI 一致，但要确认：当 NetworkGuard 阻断时，用户实际上连“connect”时刻都看不到完整 UI。

## 3. 修复计划（Fix Plan）

### Step A — 放宽网络匹配规则

1. 在 `computeNetworkStatus()` 中增加映射逻辑：
   ```ts
   const normalize = (value?: string | null) => {
     if (!value) return undefined;
     const normalized = value.toLowerCase();
     if (['aptos testnet', 'testnet', 'aptostestnet'].includes(normalized)) return 'testnet';
     if (['aptos mainnet', 'mainnet', 'aptosmainnet'].includes(normalized)) return 'mainnet';
     if (['aptos devnet', 'devnet'].includes(normalized)) return 'devnet';
     if (['aptos local', 'local', 'localhost'].includes(normalized)) return 'local';
     return normalized;
   }
   ```
   - `actual` / `expected` 都用此函数归一化。
   - 这样 `actual="Aptos Testnet"` → `"testnet"` 与 expected 匹配。
2. 补充 `network?.chainId` 备选方案（部分钱包提供 chainId，但 name 不准）。

### Step B — 细化 NetworkGuard UX
1. 即使网络不匹配，也显示当前连接信息与“Connect”按钮（提示用户网络不对但允许重试）。
2. fallback 可包含“仍要继续”（开发模式），或至少显示“Refresh network status”按钮与错误文案。
3. 在 `NetworkGuard` 中加入 `useEffect(() => !isMatch && refreshNetworkStatus(…)` 等自动刷新，确保从钱包切换网络后 UI 会自动恢复。

### Step C — 确保 BFF 生命周期可控
1. 文档（README 或 Runbook）强调：先 `pnpm --filter @haigo/bff prisma:migrate:deploy`，再 `pnpm --filter @haigo/bff start`。
2. 提供开发脚本（如 root `pnpm dev:stack`）一次性启动 BFF + Web。
3. 监控：在首页若检测到 `/api/session/challenge` 失败，提供明显提示“Backend offline? Start @haigo/bff server”。
   - 可在 `useAuthSession` 中捕获 `TypeError: fetch failed`，给出特定文案。

### Step D — 对齐注册页体验
1. 保留目前的多按钮列表 + `Disconnect`，这就是注册页的交互范式（复用其样式）。
2. `useAuthSession` + `useAccountRegistration` 的状态文案已与注册页一致；继续保持。
3. 将 `connectionDescription` 放入 Hero 里展示当前连接状态（已完成）。

### Step E — 测试 & 验证
1. 单元测试：`computeNetworkStatus` 新增映射规则测试；`useAuthSession` 已覆盖（保留）。
2. 手工回归：
   - Wallet 在 Testnet → 页面不再提示切换网络；签名后成功跳 Dashboard。
   - 关闭 BFF → 首页显示“Backend offline”提醒。
   - Wallet 切换到 Mainnet → 雷同 fallback 提示，且点击“Retry”后恢复。
3. 长期：考虑加 Playwright E2E（mock 钱包或接入 dev 钱包）。

## 4. 附加建议

- Dashboard 守卫保持严格（需要 Cookie）；当前 dev API 已写 HttpOnly cookie，可满足。
- 如果仍担心 NetworkGuard 切换网络时刷新不及时，可在 wallet context 中监听 `wallet?.network?.chainId` 的事件（部分适配器支持 `onNetworkChange`）。
- 在首页/注册页集中展示“正在连接哪个钱包”“当前网络”“失败原因”，让用户一步到位看到问题所在。

## 5. 行动清单

1. 更新 `computeNetworkStatus()`（apps/web/lib/wallet/context.tsx）增加网络名称映射与 chainId fallback。
2. 修改 `NetworkGuard`：
   - fallback 仍提示但可显示 connect UI。
   - 改善提示文字；提供明确 `Retry` / `Refresh network` 按钮。
3. `useAuthSession`：
   - 捕捉 `fetch failed`，提示“Backend offline？”。
4. 文档：
   - README/Runbook 更新：启动顺序、BFF 迁移、调试指引。
5. 测试：
   - 单测 `computeNetworkStatus`。
   - 手工验证 3 种场景（Testnet 正常、Mainnet 错误、BFF 宕机）。

