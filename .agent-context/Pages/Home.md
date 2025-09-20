# Home 页面问题分析与执行计划（UI/UX 与登录）

问题概述
- 在主页（Landing）连接钱包成功后，进入“已注册帐号”的会话初始化阶段，出现报错：`Wallet did not return a login signature.`，导致无法完成会话建立与跳转仪表盘。

触发路径（复现步骤）
1. 打开首页 `apps/web/app/page.tsx`。
2. 点击 Connect Wallet，钱包显示为已连接（Petra 等）。
3. 前端调用注册状态检查（`useAccountRegistration.check`）返回 registered。
4. 进入会话建立流程（`ensureSession(address, signMessage)` → POST `/api/session/challenge` → 钱包 `signMessage` → POST `/api/session/verify`）。
5. 钱包未返回签名或返回体缺少 `signature/publicKey` 字段，`ensureSession` 抛出上述错误。

根因分析
- 直接原因：`ensureSession.ts` 中调用 `signMessage` 后返回结果为空或字段缺失（见 `apps/web/lib/session/ensureSession.ts`）。
  - 用户关闭签名弹窗/取消签名，钱包返回空值。
  - 钱包实现兼容性差异：返回对象不含 `signature/publicKey`（旧实现或被扩展屏蔽）。
  - 签名触发时机/UX 不佳：自动触发在副作用中，用户还未感知到需要“登录签名”。

关联症状
- 浏览器 Network 中 `/api/session/profile` 返回 401，表示会话 Cookie 未写入（`/api/session/verify` 未成功或未被调用）。
- 控制台可能出现 Petra “already connected” 的噪声错误（重复连接），会干扰感知但与签名缺失并非同一根因。

定位要点（排查清单）
- 确认钱包是否弹出签名窗口，如被浏览器阻拦/扩展拦截需允许弹窗。
- 确认 `signMessage` 被实际调用（可在 `ensureSession` 前后加日志）。
- 如使用 Petra，确认已授权 dApp，且未在钱包内关闭“消息签名”能力。
- 检查 BFF 与前端域名一致性，确保 `Set-Cookie: haigo_session=...` 能被浏览器接受（同源/CORS/credentials）。

已实施的前端优化
1) 钱包重复连接的报错吞掉处理（Petra already connected）
   - 文件：`apps/web/lib/wallet/context.tsx`
   - 逻辑：若当前已连接同名钱包，`connect` 直接短路返回；如报错包含 `already connected`，视为非致命忽略。

2) 主页 UX 调整以符合 5-前端体验规范，并显式提供“Sign in”重试入口
   - 文件：`apps/web/app/page.tsx`
   - 变更：
     - Hero 区新增 `Sign in` CTA：当“已连接且已注册但未建立会话”时，手动触发 `ensureSession`，引导用户二次签名。
     - 出现 `did not return a login signature` 时给出友好文案，提示点击 `Sign in` 重试。
     - 保留 `Retry lookup` 仅用于注册资料查询重试，不再混淆与登录签名。
     - 完整 Home V2 结构：Hero、价值网格、四步流程、指标、页脚。

3) 兼容未返回 publicKey 的钱包
   - 文件：`apps/web/lib/session/ensureSession.ts`
   - 改动：`ensureSession(address, signMessage, fallbackPublicKey?)` 新增 `fallbackPublicKey`，若钱包签名返回缺少 `publicKey`，则回退使用钱包上下文中的 `accountPublicKey`。
   - 呼叫方：`apps/web/app/page.tsx` 与 `apps/web/features/registration/RegisterView.tsx` 均传入 `accountPublicKey` 作为回退。

4) 简化登录入口，移除 Google/Apple 等无关登录
   - 主页仅保留两个 CTA：`Connect Wallet`（主）与 `Register Identity`（副）。
   - `Connect Wallet` 单按钮触发连接首个可用钱包，避免多按钮冗余；仍可后续升级为 Dropdown 选择（Shadcn DropdownMenu）。

建议的进一步改进
- 交互优化：将自动签名触发改为“用户点击 Sign in 后再触发”，避免副作用中弹窗被忽略。
- 回退策略：对 `signMessage` 的用户取消/无权限的错误做分类提示（如 `User rejected` / `Permission denied`）。
- 监控埋点：上报签名弹窗触发、成功、取消的事件，辅助定位场景分布。

验证步骤（本地 curl）
1) 获取挑战
   curl -i -X POST http://localhost:3001/api/session/challenge \
     -H 'Content-Type: application/json' \
     --data '{"address":"0x你的地址"}'

2) 在浏览器控制台执行钱包签名（以 Petra 为例）
   await window.aptos.signMessage({
     message: 'HaiGo login challenge: <nonce>',
     nonce: '<nonce>',
     address: false,
     application: false,
     chainId: false
   })

3) 校验并写入会话
   curl -i -X POST http://localhost:3001/api/session/verify \
     -H 'Content-Type: application/json' -c cookies.txt \
     --data '{"address":"0x...","publicKey":"<pubKey>","signature":"<sig>"}'

4) 读取会话资料
   curl -i http://localhost:3001/api/session/profile -b cookies.txt

代码锚点
- 会话：`apps/web/lib/session/ensureSession.ts`、`apps/web/lib/api/session.ts`、`apps/web/lib/server/session.ts`
- 钱包：`apps/web/lib/wallet/context.tsx`、`apps/web/lib/wallet/network-guard.tsx`
- 首页：`apps/web/app/page.tsx`、`apps/web/lib/hooks/useAccountRegistration.ts`

执行计划（本次迭代）
1) 修复登录签名的兼容性
   - [已完成] ensureSession 支持 fallback publicKey；首页与注册页传入 `accountPublicKey`，解决部分钱包不返回 publicKey 的报错。
   - [已完成] BFF 支持校验 wallet `fullMessage`（若前端传入则直接验证这一原文），否则按 Aptos Signed Message 规范组装消息再验签，修复 verify 端 401。
   - [已完成] 新增前端 dev API `/api/dev/session/sync` 将 BFF 返回的 `sessionId` 写入同域 HttpOnly Cookie，SSR 可读取；确保 Dashboard 守卫可放行。

2) 对齐首页 UI/UX 到规范（docs/architecture/5-前端体验.md）
   - [已完成] Hero：主标题/副文案 + 主 CTA（Connect Wallet）+ 次 CTA（Register）。
   - [已完成] 价值网格（Shadcn Card）。
   - [已完成] 四步流程（Connect → Register → Create Order → Track & Verify）。
   - [已完成] 指标带与页脚。
   - [已完成] 连接按钮策略：无钱包时禁用提示、单一钱包时显示“Connect {name}”、多钱包时展示多个连接按钮（均使用 Shadcn Button）。
   - [进行中] 视觉细节（渐变背景、排版层次、移动端间距）继续微调。

3) 清理多余登录方式
   - [核验] 项目中未启用 Google/Apple 登录；保留钱包登录与注册 CTA。

6) 快速修复项
   - [已完成] favicon 404：在根布局通过 metadata.icons 指向空 data URI，避免 404 噪声。

——

全面计划：参考注册页实现，重构首页“连接即登录”流程（A→B）

目标
- 复用注册页（RegisterView）已验证可靠的交互、状态与错误处理模式，使首页“连接即登录”的签名握手与重定向稳定可测。
- 统一会话建立逻辑（ensureSession）为单一真理源，前后端签名校验口径一致（Aptos Signed Message）。

现有可复用能力（来自注册页）
- NetworkGuard：阻断网络不匹配场景与重试 UI。
- 明确的阶段状态与文案（submitting/pending/success/failed），`aria-live` 公告。
- 成功后自动重定向与错误回退提示。

重构方案（分阶段）
Phase 1 – 会话与签名对齐（后端/前端基础）
- 后端（已完成）：verify 支持 fullMessage；无 fullMessage 时按 Aptos 规范拼装签名原文；返回 sessionId。
- 前端（已完成）：ensureSession 支持 fallbackPublicKey；verify 后调用 `/api/dev/session/sync` 写 HttpOnly Cookie；失败降级非 HttpOnly。
- 行为对齐：首页也像注册页一样，仅在“用户明确操作后”触发签名（点击 Connect 之后）。

Phase 2 – 新的首页登录状态机（复用注册页思想）
- 新增 Hook：`useAuthSession`（apps/web/lib/hooks/useAuthSession.ts）
  - state: idle → requesting_challenge → awaiting_signature → verifying → verified → error
  - methods: begin(address) / retry() / reset()
  - 依赖 ensureSession，内部处理错误分类（用户拒绝、无公钥、网络/401、未知）。
- 首页调用关系：
  - 点击 Connect Wallet → 检查注册：registered/unregistered。
  - 若 registered：调用 `auth.begin(address)`（内部触发 challenge+签名+verify+dev sync）。
  - 成功后 400ms 跳转到 `/dashboard/{role}`。
  - 失败：展示原因与“Retry”（调用 `auth.retry()`），不自动循环签名，避免骚扰。

Phase 3 – UI 统一（严格遵守 5-前端体验.md）
- Hero：
  - Primary CTA：Connect Wallet（触发上述状态机）。
  - Secondary CTA：Register Identity（跳转 /register）。
  - 仅在 `status=error` 时显示重试与明确原因，文案与注册页一致风格。
- Value Grid、How it works、Metrics、Footer：保留现有实现，微调间距/响应式。
- 可访问性：aria-live、按钮禁用态、错误信息 role=alert。

Phase 4 – 监控与可测试性
- 单元测试：
  - useAuthSession：状态迁移、错误分支覆盖（拒绝签名、401、无 publicKey、fullMessage 回退）。
  - ensureSession：fallbackPublicKey、dev sync 成功/失败降级。
- 组件测试：
  - 首页交互：成功跳转、失败重试按钮与提示。
- E2E（后续）：
  - Mock 钱包（或引入测试钱包适配器），覆盖 challenge → sign → verify → profile → redirect。

Phase 5 – 配置与运维
- CI/CD：apps/bff 启动/部署流程确保 `prisma migrate deploy`。
- 开发开关（仅 dev）：可加 `ALLOW_DEV_BYPASS` 允许直达 Dashboard（仅当明确设置时生效）。

验收标准
- 已注册账户在首页点击 Connect Wallet 后，100% 进入对应 Dashboard（浏览器已允许弹窗且钱包未拒绝签名）。
- 401 与“did not return a login signature”均归类并给出明确提示与重试入口。
- SSR 守卫读取同域 HttpOnly Cookie 正常放行。
- 单测覆盖 useAuthSession 与 ensureSession 的关键分支；手动验证 curl 链路通过。

实施清单（任务级）
1) 新增 Hook：apps/web/lib/hooks/useAuthSession.ts（见 Phase 2）
2) 首页接入 useAuthSession，替换现有 ensureSession 直接调用入口
3) 优化错误文案：与注册页一致（用户拒绝/网络问题/钱包不支持）
4) 补充 Vitest：useAuthSession 与首页交互测试
5) （可选）新增 dev-only Dashboard 旁路开关
6) README/Runbook：补充登录流程说明与常见问题

迁移注意
- 保留 ensureSession 作为底层 API；useAuthSession 仅封装状态与交互。
- 保持与注册页共享的样式与反馈体验一致，减少用户心智切换。

4) 交互与可访问性
   - [已完成] 登录失败错误提示；`aria-live` 宣告；按钮状态（disabled/processing）。
   - [计划] 引入 Shadcn 的 Toast 与 Separator 丰富反馈（后续迭代）。

5) 风险与回滚
   - 若个别钱包仍无法返回公钥且上下文也缺失（极少见），将继续提示用户在注册页完成一次自动登录，再回到首页（注册页已含更完整流程与文案）。

## 2025-09-19 新发现：Connect Wallet 二次点击无效
- 现象：首次连接 Petra 后 `ensureSession` 因签名缺失报错，UI 提示“点击 Connect Wallet 重试”，但二次点击按钮完全没有反应。
- 复现：在首次连接阶段取消 Petra 的消息签名 → 页面出现 `Wallet did not return a login signature` → 保持钱包仍处于已连接状态，重新点击首页 Connect Wallet。
- 根因：`apps/web/lib/wallet/context.tsx:120` 为规避 Petra 抛出的 “wallet is already connected” 异常，增加了 `if (wallet?.name === walletName && connected) return;` 短路。首页按钮在已有连接时只调用 `connect(choice.name)`，因此直接命中该 return，既不会重新触发钱包弹窗，也不会再次调用 `ensureSession`，导致按钮“无反应”。
- 影响：用户一旦在第一次签名阶段取消或失败，就只能手动断开钱包或刷新页面才能恢复；首页文案指引“再次点击 Connect Wallet”无法兑现。
- 建议：在已连接状态下，Connect 按钮应触发 session 复位流程（例如调用 `ensureSession` 或先 `disconnect` 再 `connect`），或恢复单独的 “Sign in”/“Retry Sign-in” 操作入口，避免与短路逻辑冲突。

### 追加调查：BFF 未启动导致数据请求失败
- 控制台错误 `GET http://localhost:3001/api/accounts/... net::ERR_CONNECTION_REFUSED` 表明前端正在调用运行在 3001 端口的后端服务（BFF），但该服务未启动或端口被占用。
- 这会影响注册状态检查 `useAccountRegistration.check` 的初始调用，使页面持续处于 `checking/ waiting` 状态并触发 Fast Refresh。
- 解决：在仓库根目录运行 `pnpm dev:bff`（或对应 docker compose），确保 BFF 监听 3001，再刷新页面。该问题与 Connect 按钮短路是两个独立因素，需同时处理。

### 2025-09-19 控制台长日志的逐项分析
1. `react-dom.development.js:38560 Download the React DevTools…`
   - 说明：开发模式下 React 的常规提示，鼓励安装 DevTools，与功能故障无关。
2. `content.js:2 Check phishing by URL: Passed.`
   - 说明：浏览器扩展（例如 Petra）执行的钓鱼检测日志，安全提示，无需处理。
3. `GET http://localhost:3001/api/accounts/... net::ERR_CONNECTION_REFUSED`
   - 说明：前端调用 `fetchAccountProfile`（位于 `apps/web/lib/api/registration.ts:48`）尝试访问 BFF `/api/accounts/:address` 接口，用于确认钱包是否已注册。
   - 根因：本地 3001 端口未监听（BFF 未启动或被占用），浏览器无法建立 TCP 连接，直接抛出 `ERR_CONNECTION_REFUSED`。
   - 影响：
     - `useAccountRegistration` 钩子在 `LandingPage` 与 `RegisterView` 中均会触发，导致两个页面都在每次连接后进行轮询，全部失败。
     - 由于 `check()` 调用位于 `useEffect`，错误会成为未捕获异常并打印完整调用栈（React 会执行 Passive Effects 的提交流程，因此日志中出现了大量 `commitPassiveMountOnFiber` 调用记录）。
     - 注册状态一直保持在 `checking/waiting/error` 循环，阻断后续 `ensureSession` 和导航逻辑。
4. `[Fast Refresh] rebuilding / done`
   - 说明：Next.js 开发模式的热更新提示，代码变动或错误重渲染时出现，与 Connect 失效无直接关联，但网络请求失败会导致 React 状态变化从而触发界面重渲染。

#### 结论
- 当前的阻断源自 **后端服务未启动**。在尝试任何前端修复前，必须先在仓库根目录运行 `pnpm dev:bff`（或对应的 docker-compose 命令），确保 `http://localhost:3001` 可访问。
- Connect Wallet 二次点击无响应的问题依旧存在，其代码根因仍是 `connect()` 内的“已连接短路”逻辑；即便 BFF 启动，该 UX 仍需另外修复。

#### 排查建议
1. 后端：
   - 启动 BFF → `pnpm dev:bff`
   - 监听日志确认成功绑定 `:3001`
   - 如端口被占用，排查本地冲突或更新 `.env` 中的端口配置并同步前端请求地址。
2. 前端防御：
   - 在 `fetchAccountProfile` 调用处增加对 `ERR_CONNECTION_REFUSED` 的用户提示或重试退避，防止控制台刷屏。
   - 考虑在 `LandingPage` 上检测 BFF 健康状态，没连通时提示“后台服务未启动”。
3. Connect 交互：
   - 允许二次点击在 `status === 'connected'` 时重新触发 `ensureSession`，或提供单独的“Sign in / Retry”按钮，与钱包短路逻辑兼容。


### 2025-09-19 登陆页改版与实现要点
- 重写 `apps/web/app/page.tsx`，将登陆页拆分成状态驱动的流程：
  1. 优先连接 Petra/Martian，一次按钮即可完成“连接 + 签名登录”；
  2. 自动检测注册状态，注册成功后仅触发一次 `ensureSession`，失败时按钮会切换成 Sign in 以便重试；
  3. 会话阶段细分为 preparing / signing / verifying / ready，UI 实时提示签名与校验进度。
- 显式处理 BFF 不可达：
  - 捕获 `ERR_CONNECTION_REFUSED` / `Failed to fetch`，在 Hero 区域提示“启动 pnpm dev:bff”；
  - 注册轮询失败时不会重复弹栈，且保持重试按钮可用。
- Connect 按钮新策略：
  - 未连接 → 按优先级选择钱包并连接；
  - 已连接且已注册 → 直接触发 `ensureSession`，不会被 “already connected” 短路；
  - 已连接但未注册/出错 → 触发注册状态刷新。
- 提供 Disconnect、Register Identity、Retry lookup 等辅助操作；保持原价值网格/流程/指标布局。
- 运行 `pnpm --filter @haigo/web lint` 确认无 ESLint 错误。

TODO / 后续建议
1. 若后端域名变更，可将 `http://localhost:3001` 提示抽成配置。
2. 可为 session 错误添加 Toast 反馈，避免 Hero 文案堆叠。
