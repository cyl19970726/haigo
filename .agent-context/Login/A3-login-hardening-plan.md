# A3 — 登录流程加固与仪表盘守卫实施计划（Design → Steps → Tests）

> 本工作项（A3）目标：统一账户资料 DTO，增强登陆首页的网络/索引容错能力，并为 `/dashboard/**` 加上最小可用的会话守卫，确保用户连接钱包后能准确识别注册状态并安全进入仪表盘。
>
> 相关数据流：`.agent-context/AUTH/data-stream-login.md`（登录态 → BFF → Dashboard）、`.agent-context/AUTH/A1-login-implementation-plan.md`（既有登陆逻辑）、`.agent-context/AUTH/A2-homepage-ux-plan.md`（首页 UX 目标）。

## 0. 上下文与需阅读文档
- 场景数据流：`docs/architecture/data-stream-login.md`、`docs/architecture/10-场景化端到端数据流.md`（10.2 登录、10.3 注册完成重定向）。
- 前端规范：`docs/front-end-spec.md`（Homepage & Auth、Dashboard requirements）。
- 共享类型：`packages/shared/src/dto/registry.ts`（AccountResponse/Profile 定义）。
- 后端模块：`apps/bff/src/modules/accounts`（Controller/Service/Repository）。
- 既有前端实现：`apps/web/app/page.tsx`（Landing）、`apps/web/lib/api/registration.ts`（fetchAccountProfile）、`apps/web/features/registration/RegisterView.tsx`（注册视图流程）。

## 一、范围与新增/变更模块
- Shared DTO（`packages/shared`）
  - 统一 `AccountResponse` & `AccountProfile` 字段（`profileHash.algorithm` vs `algo`），导出对应 type guard，更新消费方引用。
- BFF（`apps/bff`）
  - 更新 `AccountsService.getAccountProfile` 返回结构，使其符合统一 DTO，并补充 `isRegistered`/`role` 判定工具。
  - 新增 Session 控制器 `AuthSessionController`（暂定 `/api/session`），实现 nonce 挑战与验证（保存在 Redis 或内存占位）。
  - 为 `/api/accounts/:address` 增加 trace 日志，支持 404→null 语义供前端判定。
- 前端（`apps/web`）
  - Landing 页面：引入 `NetworkGuard`、指数退避重试、延迟重定向（60s 容忍窗口），对索引延迟给出友好提示。
  - 新增 `useAccountProfile` Hook 封装登陆流程（连接 → fetch → 重试 → redirect）。
  - Dashboard 中间件：`apps/web/middleware.ts` 或 `app/(dashboard)/layout.tsx` 中调用 `/api/session/profile` 验证，阻止未登录访问。
  - 注册页：成功后触发 session 刷新（调用 `/api/session/refresh`），并沿用登陆守卫逻辑。
- 基础设施
  - 会话存储（可先使用 Nest 内存 cache + TODO 注记，后续可迁移 Redis）。

非目标（本 A3 不包含）
- 完整 OAuth/多因子机制。
- 多角色扩展（仅 seller/warehouse）。
- 零信任访问控制（后续迭代）。

## 二、设计细节（Anchors）

### 2.1 Shared DTO 对齐
文件：`packages/shared/src/dto/registry.ts`
```ts
export interface AccountResponse {
  address: string;
  role: 'seller' | 'warehouse';
  profileHash: {
    algorithm: 'blake3';
    value: string;
  };
  registeredAt: string;
  profileUri?: string;
  orderCount?: number;
}

export const normalizeAccountResponse = (payload: AccountResponse | LegacyAccountResponse): AccountResponse => ({
  address: payload.address.toLowerCase(),
  role: payload.role,
  profileHash: {
    algorithm: payload.profileHash.algorithm ?? payload.profileHash.algo,
    value: payload.profileHash.value
  },
  registeredAt: payload.registeredAt,
  profileUri: payload.profileUri,
  orderCount: payload.orderCount
});
```
- 更新 FE `fetchAccountProfile` 使用 `normalizeAccountResponse`，确保 `algorithm` 始终存在。
- 调整测试 `apps/web/lib/api/registration.test.ts` 校验字段。

### 2.2 BFF 登录 API 调整
- `apps/bff/src/modules/accounts/accounts.service.ts`
  - 返回 `AccountResponse`（含 `profileHash.algorithm`）。
  - 保留 `NotFoundException`，Controller 捕获后返回 404，使前端收到 null。
- `apps/bff/src/modules/accounts/accounts.controller.ts`
  - `getAccountProfile`：捕获 `NotFoundException` → `res.status(404).json({ data: null, meta })`。
  - 追加 trace logger，记录 address、耗时、结果。
- 新增 `apps/bff/src/modules/auth-session`
  - `POST /api/session/challenge`：接收 `address`，生成 nonce（UUID + timestamp），暂存，返回 nonce。
  - `POST /api/session/verify`：接收 `address`, `signature`，用 Aptos SDK 验证签名后写入 session cookie（HttpOnly、Secure）。
  - `GET /api/session/profile`：读取 session → 返回账户资料（调用 `AccountsService`）。
  - 会话存储先使用 Nest CacheModule 内存实现（标注后续接入 Redis）。

### 2.3 前端登录流程强化
- `apps/web/lib/api/registration.ts`
  - 新增 `fetchAccountProfileWithRetry(address, { attempts, delay })`。
  - 同步更新 tests 覆盖 404/500/成功。
- `apps/web/app/page.tsx`
  - 使用 `useAccountProfile` Hook：
    1. 连接钱包 → 检查网络（`NetworkGuard` 包裹 CTA）。
    2. 记录 announce 信息（aria-live）。
    3. 对 404 情况展示「未注册 / 正在等待索引」提示，提供“稍后重试”按钮。
    4. 对成功返回，根据 `role` 跳转 `/dashboard/{role}`。
    5. 对异常（500、网络错误）展示 toast/alert，并允许重试。
- `apps/web/lib/hooks/useAccountProfile.ts`
  - 暴露 `checkRegistration()`、`state`（idle/loading/registered/unregistered/error/waitingIndex）。
- `apps/web/app/(dashboard)/layout.tsx` 或 `middleware.ts`
  - 在渲染 dashboard 前调用 `/api/session/profile`，若缺失 → redirect('/')。
  - 注册页若已注册（session 存在）则 redirect('/dashboard/...')。

### 2.4 注册流程衔接
- `apps/web/features/registration/RegisterView.tsx`
  - 成功后：
    1. 调用 `await refreshSession()`（命中 `/api/session/verify` 或 `/api/session/profile`）。
    2. 重试 `fetchAccountProfileWithRetry`（60s fallback）。
    3. 按登陆同样逻辑跳转。
  - UI：在等待索引时显示剩余时间、提供“复制 Tx Hash”链接。

### 2.5 配置与环境
- 新增环境变量：
  - `SESSION_SECRET`（BFF 用于签名 cookie）。
  - `NEXT_PUBLIC_SESSION_CHECK_PATH`（可选；前端默认 `/api/session/profile`）。
- 更新 `apps/web/.env.example`、`apps/bff/.env.example`。

## 三、跨模块协同
- Wallet Adapter：保持 autoConnect，Landing Guard 在 `focus` 时刷新网络状态。
- BFF ↔ Shared DTO：更新后需跑 `pnpm build --filter @haigo/shared` 以生成最新类型。
- Session 持久层：初期使用内存，部署前需替换为 Redis/Upstash；计划文档中标注风险。

## 四、注意事项（实现 & 运维）
- 错误处理：前端需从响应头里读取 `x-haigo-trace-id` 供支持排查。
- 安全：Session cookie `Secure`, `HttpOnly`, `SameSite=lax`；CORS 配置允许 web origin。
- 可观测性：登陆 API 记录耗时、结果；session 验证失败应打 WARN 日志。
- 性能：重试策略指数退避（1s, 3s, 9s），总时长 < 15s；避免无限轮询。
- 无痕模式：若 cookie 不可写，提示用户开启 cookie。

## 五、需同步更新的文档
- `docs/architecture/data-stream-login.md`: 更新状态图（加入 Session Guard）。
- `docs/front-end-spec.md`: Homepage 登录交互、错误/等待索引状态、Dashboard 访问守卫说明。
- `.agent-context/status.md`: A3 状态与下一步。

## 六、测试计划
- **Shared**：在 `packages/shared` 添加 `normalizeAccountResponse.test.ts`（legacy → canonical）。
- **BFF 单元/集成**
  - `accounts.controller.spec.ts`: 验证 404 返回 `data: null`、trace header 保留。
  - `auth-session.controller.spec.ts`: 挑战、验证、读取 profile 正常/失败路径。
  - `accounts.service.spec.ts`: 覆盖 algorithm 映射、订单计数失败 fallback。
- **前端单元**
  - `apps/web/lib/api/registration.test.ts`: 重试逻辑、错误信息。
  - `apps/web/lib/hooks/useAccountProfile.test.tsx`: 状态机覆盖。
  - `apps/web/app/page.test.tsx`: 渲染 CTA、错误提示、重试按钮。
- **E2E（Playwright）**
  - Mock 钱包：已注册地址 → 连接后跳 `/dashboard/seller`。
  - 未注册 → 提示注册并可前往 `/register`。
  - session 失效访问 `/dashboard` → 重定向 `/`。

## 七、验收标准
- FE/BFF 使用统一 DTO，不再出现 `profileHash.algo undefined`；相关测试通过。
- Landing 页在网络不匹配、404、索引延迟、错误等场景均给出明确反馈，不会误导跳转。
- `/dashboard/**` 未验证会话无法访问；注册成功用户无需刷新即可进入对应仪表盘。
- 新增/更新的测试覆盖率通过，CI 无回归。
- 文档/状态同步完成。

## 八、实施步骤（Checklist）
1. 对齐共享 DTO 与 BFF 返回结构，更新并通过单元测试。
2. 实现并验证 Auth Session Controller（挑战、验证、profile）。
3. 更新前端 API Hook 与 Landing 页面逻辑，接入 NetworkGuard 与重试机制。
4. 在 dashboard/register 路径加会话守卫与状态同步。
5. 自测注册 → 登录 → Dashboard 流程（含索引延迟模拟）。
6. 回填文档、状态，并准备发布说明。

完成定义（DoD）
- 所有步骤完成，测试覆盖通过，文档更新。
- 本地或测试环境跑通 connect → registered redirect → dashboard 守卫链路。
- 发现的后续风险（会话存储、正式环境依赖）记录在 issue/计划中。

## 九、参考文档
- `docs/architecture/index.md`
- `docs/front-end-spec.md`
- `.agent-context/AUTH/data-stream-login.md`
- `.agent-context/AUTH/A1-login-implementation-plan.md`
- `.agent-context/AUTH/A2-homepage-ux-plan.md`
