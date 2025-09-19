# AUTH — Dashboard Logout/Disconnect 实施计划（需求→文档→设计→实现→Checklist→文档更新）

> 目标：在 Seller/Warehouse 两个 Dashboard 页提供显著的“退出登录/断开钱包”入口，清理会话并返回登录/落地页；与现有钱包上下文与会话 API 保持一致。

## 一、功能需求（Functional Requirements）
- 在以下页面右上角提供“Sign out/退出登录”按钮（或用户菜单项）：
  - `/dashboard/seller`（SellerDashboard）
  - `/dashboard/warehouse`（WarehouseDashboard）
- 行为要求：
  - 点击后：
    1) 调用 `POST /api/session/logout` 清理 BFF 会话（如有服务端 cookie）。
    2) 调用前端 `useWalletContext().disconnect()` 断开钱包连接，清理本地状态。
    3) 清理与账号相关的临时缓存（可选：订单表单缓存、媒体草稿缓存）。
    4) 跳转到首页 `/`（或登录入口）。
  - 失败容错：若某一步失败也应继续尝试其余步骤，并在 UI 提示“已断开连接”。
- 可访问性：
  - 提供可见标签与 `aria-label="Sign out"`，操作完成后以 `aria-live=polite` 宣告。

## 二、必读文档（Must‑Read）
- 前端会话与钱包：
  - `apps/web/lib/wallet/context.tsx`（`disconnect()` 可用）
  - `apps/web/lib/api/session.ts`（`logoutSession()` 可用）
- 仪表盘容器：
  - `apps/web/app/dashboard/seller/page.tsx`
  - `apps/web/app/dashboard/warehouse/page.tsx`
- 规范：`docs/front-end-spec.md`（Dashboard 线框与卡片段，需增补用户菜单/Sign out）
- 模板：`.agent-context/Plan-Template.md`

## 三、完整代码设计（Complete Code Design）

1) 前端组件与行为
- 新增通用组件 `UserActions`（或最小改动：在各 Dashboard 页 header 中直接放置按钮）。
- 点击逻辑：
```ts
import { useWalletContext } from '@/lib/wallet/context';
import { logoutSession } from '@/lib/api/session';
import { useRouter } from 'next/navigation';

async function onSignOut() {
  try { await logoutSession(); } catch {}
  try { await disconnect(); } catch {}
  try { sessionStorage.clear(); localStorage.removeItem('haigo:orders:create'); } catch {}
  router.push('/');
}
```
- 文案与样式：次级按钮风格，右上角放置，移动端折叠到溢出菜单。

2) 路由保护（可选增强）
- 在 Dashboard 页首部加入简单客户端守卫：若 `useWalletContext().status==='disconnected'` 且无会话，提示登录或自动跳转首页。

3) 观测与日志
- 在前端加 `console.info('[HaiGo] user signed out')` 便于调试（生产可移除或上报）。

4) 兼容性
- 若后端无会话（纯前端钱包登录），`logoutSession` 可无害返回；断网投递失败也不阻止本地断开与跳转。

## 四、实现计划（Steps）
1. 在 `apps/web/app/dashboard/seller/page.tsx` 的 header 右侧加入 Sign out 按钮；点击调用 `logoutSession`+`disconnect`+跳转。
2. 在 `apps/web/app/dashboard/warehouse/page.tsx` 同步新增。
3. 抽出公共按钮组件到 `apps/web/features/auth/SignOutButton.tsx`（可选）；避免重复逻辑。
4. 前端测试：
   - 单测：mock `logoutSession` 与 `disconnect`，验证调用顺序与重定向。
   - 端到端：点击按钮后回到首页，钱包状态为 disconnected。
5. 文档回填：更新 `docs/front-end-spec.md` 的 Dashboard 段增加“User Actions / Sign out”说明与 ASCII。

## 五、Checklist（执行核对）
- [ ] Seller Dashboard 有 Sign out 按钮
- [ ] Warehouse Dashboard 有 Sign out 按钮
- [ ] 点击后服务端会话清理 + 钱包断开 + 本地缓存清空 + 跳转首页
- [ ] 出错时仍能断开并跳转，提示友好
- [ ] 测试通过：单元/端到端
- [ ] 文档已回填（front-end-spec）

## 六、文档更新（Docs Updates）
- `docs/front-end-spec.md`：Dashboard 区域增加“User Menu / Sign out”小节与锚点。
- 如后续引入 SSR 会话或 BFF Auth，补充 `docs/architecture/5-前端体验.md` 的登录/登出流程图。

## 七、实施后 Review（Post‑Implementation Review）
- 功能：两个 Dashboard 均能退出并跳转；钱包状态为 disconnected；会话 cookie 清理生效。
- 可用性：按钮位置与可访问性符合规范；移动端可达。
- 稳健性：后端不可达时仍能本地退出；无残留缓存导致的脏数据。
- 文档：front-end-spec 的小节与 ASCII 一致；Anchors 指向正确文件。

