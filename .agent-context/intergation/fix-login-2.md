# fix-login-2.md — 多流程登录与注册修复方案

## 1. 当前实现速览

### 1.1 前端流程
- **钱包上下文 (`apps/web/lib/wallet/context.tsx`)**：基于 `@aptos-labs/wallet-adapter-react` 提供 `WalletContext`，暴露 `status / accountAddress / accountPublicKey / networkStatus / connect / disconnect / signMessage` 等能力，所有前端流程依赖该上下文。
- **首页登陆流程 (`apps/web/app/page.tsx`)**：
  - 连接钱包后调用 `useAccountRegistration` 轮询 BFF `GET /api/accounts/:address`（含 3 次退避）。
  - 发现地址已注册 → 调用 `ensureSession(address, signMessage)`，经 `POST /api/session/challenge` → 钱包 `signMessage` → `POST /api/session/verify` → `fetchSessionProfile()`；成功后依据返回的 `profile.role` 跳转 `/dashboard/{role}`。
  - 未注册 → 显示注册 CTA（按钮跳转 `/register`）。
- **注册页 (`apps/web/app/(auth)/register/page.tsx` + `features/registration/RegisterView.tsx`)**：
  - 复用钱包上下文；允许上传资料（`POST /api/media/uploads`），调用 Aptos SDK 模拟、签名 `register_{seller|warehouse}` 交易。
  - 交易成功后调用 `ensureSession()` 以写入 `haigo_session`，随后根据 `accountInfo.role` 跳转仪表盘。
  - 文件、hash 元数据缓存在 `sessionStorage`（`haigo:registration:${address}`）以便恢复。
- **仪表盘守卫 (`apps/web/app/dashboard/layout.tsx`)**：服务端读取 `haigo_session` Cookie，通过 `loadSessionProfileFromServer()` 调 BFF `GET /api/session/profile`。若无会话即 `redirect('/')`。
- **仪表盘内容**：
  - 仓库页 (`/dashboard/warehouse`) 通过 `WarehouseOrdersView` 等组件调用 `fetchOrderSummaries({ warehouseAddress })`、`fetchStakingIntent(warehouseAddress)` 展示订单与质押信息。
  - 卖家页 (`/dashboard/seller`) 通过 `SellerRecentOrdersCard`、`SellerWarehouseDirectoryCard` 使用 `fetchOrderSummaries({ sellerAddress })`、`fetchWarehouses()`。

### 1.2 后端 & 数据
- **账户模块 (`apps/bff/src/modules/accounts`)**：
  - `AccountsController` 暴露 `GET /api/accounts/:address`，查 `accounts` 表（Prisma）返回 `AccountProfile`；找不到时 404 并返回 `{ data: null }`。
  - 事件监听器(`AccountsEventListener`) 订阅 Aptos Indexer `SellerRegistered` / `WarehouseRegistered` 事件写入 `accounts` 表，字段包括 `role`, `profile_hash_value`, `txn_version`, `chain_timestamp` 等。
- **会话模块 (`apps/bff/src/modules/auth-session`)**：
  - `POST /api/session/challenge`：生成随机 nonce 存入内存 `challenges` Map。
  - `POST /api/session/verify`：校验签名、公钥 → 读取账户档案 → 新建 `sessionId`（UUID）存入内存 `sessions` Map，并在响应头 `Set-Cookie: haigo_session`。
  - `GET /api/session/profile`：根据 `haigo_session` 返回 `AccountProfile`，失效则 401 并清 Cookie。
  - `POST /api/session/logout`：清空内存 session 并置空 Cookie。
- **数据库结构 (`apps/bff/prisma/schema.prisma`)**：`accounts` 表主键 `account_address`；字段 `role (AccountRole)`, `profile_hash_value`, `chain_timestamp` 等用于登陆路由与仪表盘显示。

## 2. 问题复现与根因
- 复现：使用钱包 A 登陆（仓库身份），获得 `haigo_session`；随后不登出直接连接钱包 B（尚未注册），点击注册 CTA → 服务端布局 `apps/web/app/(auth)/register/layout.tsx` 读取旧会话后立即 `redirect('/dashboard/warehouse')`，无法进入注册流程。
- 根因：
  1. **会话未与当前钱包地址对齐**——客户端没有在钱包切换时校验/清理旧 session，`haigo_session` 始终指向上一个登录用户。
  2. **注册布局只看 Cookie**——`RegisterLayout` 仅基于 `loadSessionProfileFromServer()` 判断，无视当前想要注册的钱包地址，导致所有持 cookie 的请求都被重定向到旧 dashboard。
  3. **仪表盘使用钱包地址透传数据**——仓库/卖家组件直接使用 `WalletContext.accountAddress` 作为查询参数，一旦会话指向 A、钱包连接为 B，会出现“页面展示 A 的数据，钱包操作 B”的不一致，增加潜在风险。

## 3. 修复目标
1. **多钱包切换友好**：连接新钱包时能够自动识别并清空不匹配的会话，防止错误重定向。
2. **注册入口可控**：即便浏览器存在旧 `haigo_session`，当用户明确要求为钱包 B 注册时，也应允许进入 `/register`（必要时自动登出旧会话）。
3. **登录后跳转准确**：`ensureSession` / BFF 返回的角色应驱动跳转；同时 dashboard 组件要以“服务端确认的会话地址”为准获取数据，避免越权。
4. **数据流自洽**：明确各 API 的 request/response、缓存策略、边界情况，便于后续实现与测试。

## 4. 解决方案设计

### 4.1 钱包地址与会话对齐（客户端）
- **新增 Hook：`useSessionProfile`**（`apps/web/lib/hooks/useSessionProfile.ts`）：
  - 封装 `fetchSessionProfile()`，缓存最近一次的 `{ address, role }`。
  - 暴露 `sessionProfile`, `refresh`, `clearLocalSession`（仅清前端缓存，不触发 logout）。
- **首页对齐逻辑**：
  - 在 `apps/web/app/page.tsx` 中监听 `accountAddress` 变化：
    - 若存在 `sessionProfile` 且 `sessionProfile.address !== accountAddress.toLowerCase()`，调用 `logoutSession()`（客户端 `POST /api/session/logout`，带 `credentials: 'include'`），随后调用 `sessionRef.current = null` 并清浏览器缓存（`sessionStorage`、`localStorage` 中的 registration 草稿）。
    - 这样 `/register` 不会再被旧 session 强制重定向。
- **登录成功后的状态同步**：成功调用 `ensureSession()`（注册/登陆）后，刷新 `useSessionProfile()` 以记录服务端确认地址，供后续对比。

### 4.2 注册布局按需放行
- **更新 `apps/web/app/(auth)/register/layout.tsx`**：
  - 读取 `searchParams`，接受 `address`（用户打算注册的钱包地址）与 `force`（`true`/`1` 表示强制进入注册）。
  - 加载 session profile 后：
    - 若 `!profile` → 直接渲染注册页。
    - 若有 profile 且 `(force && address && profile.address !== normalize(address))` →
      1. 调用服务端工具 `logoutSessionOnServer()`（见 4.3）清理 BFF 会话并删除响应中的 `haigo_session` Cookie。
      2. 允许渲染注册页。
    - 其他情况保持原行为（已注册用户重定向到对应 dashboard）。
- **更新注册 CTA**：在首页 `Button variant="outline" onClick={() => router.push(
  accountAddress ? `/register?address=${encodeURIComponent(accountAddress)}&force=1` : '/register'
)}`，确保强制参数传递。

### 4.3 服务端会话工具
- **扩展 `apps/web/lib/server/session.ts`**：
  - 新增 `logoutSessionFromServer(requestCookies: RequestCookies): Promise<void>`：
    - 读取 `haigo_session` 值。
    - 若存在，向 BFF `POST /api/session/logout`，`headers.cookie = 'haigo_session=…'`，`cache: 'no-store'`。
    - 使用 `cookies().delete('haigo_session')` 清除本地 Cookie。
  - `loadSessionProfileFromServer()` 保持现状，用于 SSR 守卫。

### 4.4 Dashboard 数据与会话地址绑定
- **创建共享 util `resolveActiveAddress()`**：
  - 读取 `sessionProfile`（从新建 hook）与 `WalletContext.accountAddress`。
  - 优先使用 `sessionProfile.address`（服务端确认的登录身份），若不存在则回退到钱包地址。
- **改造仓库/卖家组件**：
  - `WarehouseOrdersView`, `WarehouseStakingCard`, `WarehouseQuickActionsCard` 等请求改为使用 `resolveActiveAddress()`，确保使用的地址与当前登陆身份一致。
  - 若 `sessionProfile` 缺失（尚未登录）而钱包已连接，则提示“请登录/签名后查看数据”，并阻止危险操作。
- **在 `dashboard/layout.tsx` 将 `profile` 通过 `React.Context` 顺下发**（新建 `SessionProfileProvider`），客户端读取无需再次请求。

### 4.5 注册流程补充
- **RegisterView**：
  - 成功交易后 `ensureSession()` 改为 `await ensureSession(accountAddress, signMessage, accountPublicKey, callbacks)`，拿到 `profile` 后立即写入新的 `SessionProfileContext`，同时决定跳转路径（避免依赖 stale 的 `accountInfo.role`）。
  - 如果 `ensureSession` 失败，显示提示“自动登录失败，请使用‘前往仪表盘’按钮或点击重试签名”。
- **会话失效提示**：在注册、登陆、仪表盘等关键位加入捕获逻辑（`fetchSessionProfile` 返回 401 时清本地缓存并提示重新登录）。

### 4.6 Playwright / 单测保障
- Playwright 新增场景：
  1. 登录 A（仓库）→ 访问 `/register?address=B&force=1` → 页面应展示上传表单且无跳转。
  2. 注册成功后自动跳转 `/dashboard/{role}`，刷新页面后保持登陆。
  3. 切换钱包为未注册地址 → 首页保持在注册提示，不跳转。
- 单元测试：
  - `loadSessionProfileFromServer` + `logoutSessionFromServer` 的 happy-path & 401/500 分支。
  - `resolveActiveAddress` 的优先级逻辑。
  - `useSessionProfile` Hook 的缓存与自动刷新。

### 4.7 文档 & 配置
- 更新 `docs/architecture/data-stream-login.md`：补充钱包切换→会话清理的时序图；注明 `force=1` 注册入口逻辑。
- 更新 `docs/front-end-spec.md` 登录章节，提示产品/QA 如何复测多钱包场景。
- `README` 或 `docs/runbook.md` 提醒开发者：切换钱包时若发现被重定向，可查看登陆状态气泡或手动点击“退出登录”。

## 5. 数据流 / 接口变更摘要

| 环节 | Request | Response | 备注 |
|------|---------|----------|------|
| 会话校验（客户端） | `GET /api/session/profile`（`credentials: 'include'`） | `{ data: AccountProfile | null }` | 新 Hook 用于缓存 & 对比钱包地址 |
| 会话登出（客户端） | `POST /api/session/logout` | `{ data: true }`, `Set-Cookie: haigo_session=; Max-Age=0` | 钱包切换时调用 |
| 会话登出（服务端） | `POST /api/session/logout`（header:`cookie: haigo_session=...`） | 同上 | Register Layout 需要发送；随后 `cookies().delete()` |
| 注册重定向参数 | `/register?address=0x...&force=1` | — | `layout.tsx` 使用 `searchParams` 判断是否需要注销旧会话 |
| 仓库订单列表 | `GET /api/orders?warehouse={activeAddress}` | `{ data: OrderSummaryDto[], meta }` | `activeAddress` 来自 `sessionProfile` 首选 |
| 卖家订单列表 | `GET /api/orders?seller={activeAddress}` | `{ data: OrderSummaryDto[], meta }` | 同上 |

## 6. 验证与回归计划
1. **单元测试**：新增/调整上述 Hook 与 util 的测试；覆盖 `logoutSessionFromServer` 异常分支（BFF 不可达时 fallback 仅删除本地 Cookie）。
2. **Playwright**：执行新增多钱包场景；回归现有 `fix-login-1` 用例确保未被破坏。
3. **手工验证**：
   - 浏览器连接钱包 A → 登陆 → 切换钱包 B（未注册）→ 应留在首页/注册页，不跳转。
   - 浏览器访问 `/register?address=B&force=1` → 正常显示注册 UI。
   - 注册完成 → 自动跳转 `/dashboard/{role}`，刷新后保留登陆；注销 → 返回首页。
   - 仓库/卖家仪表盘分别验证数据拉取是否使用登录身份地址。
4. **后端观测**：确认 `AuthSessionService.destroySession` 收到额外注销调用；观察日志无异常告警。

## 7. 风险与待确认项
- **BFF 会话为内存存储**：在多实例部署场景需共享存储（Redis 等），本方案不扩大风险但需要在部署文档注明。
- **地址来自 query string**：`force` 模式下依赖客户端传递地址，需在服务器端 `normalizeAddress` 时校验 `0x[0-9a-f]+`，若不合法应忽略并仍然重定向旧 dashboard，防止恶意绕过。
- **Hook 的依赖顺序**：`useSessionProfile` 需谨慎放置，避免与 `useAccountRegistration` 互相触发无限循环。
- **旧浏览器缓存**：需要在部署变更时提醒用户，如遇意外跳转请点击“退出登录”按钮或清除站点数据。

---
上述方案确保钱包切换、注册、登陆三个入口在前后端数据流上保持一致，避免因残留会话导致的错误重定向，同时加强仪表盘数据的身份绑定与多钱包用例的测试覆盖。
