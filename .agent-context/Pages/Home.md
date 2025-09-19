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

4) 交互与可访问性
   - [已完成] 登录失败错误提示；`aria-live` 宣告；按钮状态（disabled/processing）。
   - [计划] 引入 Shadcn 的 Toast 与 Separator 丰富反馈（后续迭代）。

5) 风险与回滚
   - 若个别钱包仍无法返回公钥且上下文也缺失（极少见），将继续提示用户在注册页完成一次自动登录，再回到首页（注册页已含更完整流程与文案）。
