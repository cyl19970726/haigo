# R1 注册流程联调问题分析报告（Web → BFF CORS 与接口可用性）

生成时间：$(date '+%Y-%m-%d %H:%M:%S')

## 摘要
- 前端在 `http://localhost:3000` 下调用 BFF `http://localhost:3001` 的接口被浏览器以 CORS 拦截：
  - GET `http://localhost:3001/api/accounts/:address` → CORS blocked + 404（业务上的未注册）
  - POST `http://localhost:3001/api/media/uploads` → 实际 201 Created，但因缺少 CORS 头被拦截
- 结论：BFF 当前未启用 CORS 允许 Web 的跨源访问；接口功能已存在并有效，但浏览器端拿不到响应。
- 处置建议（其一即可）：
  1) 在 BFF 启用 CORS（推荐，简单直接）；
  2) 前端通过 Next.js rewrites 将 `/api` 代理到 BFF，改为同源调用（无 CORS）。

## 复现场景与证据
- 前端日志：
```
Access to fetch at 'http://localhost:3001/api/accounts/...' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header...
```
- 服务端路由：
  - AccountsController：`/api/accounts/:address`（apps/bff/src/modules/accounts/accounts.controller.ts:24）
  - MediaController：`/api/media/uploads`（apps/bff/src/modules/media/media.controller.ts:20, 24）
- BFF 入口（未启用 CORS）：
  - apps/bff/src/main.ts:6-13：`NestFactory.create(AppModule, { bufferLogs: true })` 后未 `enableCors`

## 问题分解与根因
1) CORS 拦截
- 根因：BFF 未添加 `Access-Control-Allow-Origin` 等响应头，也未处理预检（OPTIONS）。
- 影响：浏览器 JS 无法访问响应体，即使服务端返回 200/201 也被阻断。

2) GET /api/accounts/:address 返回 404
- 说明：404 是业务层 `NotFound`（该地址尚未被注册），属正常行为；但在 CORS 拦截存在时，浏览器仍显示 `net::ERR_FAILED 404`，容易误判为接口不存在。

3) POST /api/media/uploads 返回 201 但被拦截
- 说明：接口已实现并成功处理（201 Created）——浏览器报错是因为 CORS 头缺失。

4) Wallet 已连接重复提示
- 状态：`Petra wallet is already connected` 属用户交互提示，与本次联调问题无关，可后续优化 UX。

## 解决方案（择一或同时采用）
A. 在 BFF 启用 CORS（推荐）
- 方案：在 `apps/bff/src/main.ts` 中添加：
  - `app.enableCors({ origin: ['http://localhost:3000'], methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['content-type','authorization','x-requested-with','x-haigo-trace-id'], exposedHeaders: ['x-haigo-trace-id'], credentials: false })`
- 优点：改动小，立刻生效。保留前端使用 `NEXT_PUBLIC_BFF_URL` 的直连方式。
- 风险：需区分开发/生产域名，建议支持通过环境变量配置白名单（如 `BFF_CORS_ORIGINS`）。

B. 前端增加 Next.js 反向代理（避免跨域）
- 方案：在 `apps/web/next.config.mjs` 中配置 `rewrites()`，将 `/api/:path*` 转发到 `http://localhost:3001/api/:path*`，并在前端将 `NEXT_PUBLIC_BFF_URL` 改为 `""`（相对路径）。
- 优点：同源请求，不需要 BFF 配置 CORS；生产可挂到 Nginx/Ingress 层做统一代理。
- 风险：本地和生产代理配置需一致维护；前端需统一改为相对路径（或仅 dev 环境使用 rewrites）。

## 验证点与预期
- 启用 CORS 后：
  - GET `/api/accounts/:address` 若未注册 → 404，前端能正常收到 JSON 错误并走“未注册”分支。
  - POST `/api/media/uploads` → 201，前端能正常拿到响应 `{ recordUid, path, hash... }`。
  - 浏览器不再报 `No 'Access-Control-Allow-Origin'`。
- 使用代理后：
  - 前端请求目标变为 `http://localhost:3000/api/...`，Next dev server 转发到 BFF；CORS 不再触发。

## 建议的最小修改（供参考；本报告不直接改代码）
- BFF（Enable CORS）：
  - 文件：apps/bff/src/main.ts:6 之后
  - 逻辑：读取环境变量 `BFF_CORS_ORIGINS`（逗号分隔）或默认 `http://localhost:3000`，调用 `app.enableCors(...)`。
- 文档：在 `docs/architecture/6-部署与环境.md` 增加 “CORS 配置” 小节，明确本地与测试网的允许源。

## 其他观察
- Next `experimental.appDir` 警告：可后续清理，不影响功能。
- “404 Not Found” 与业务：确保前端对 404（未注册）有清晰的 UI 提示，避免误判为系统错误。

## 测试清单
1) BFF 启动（3001），Web 启动（3000）。
2) 打开 `/register`，观察浏览器网络面板：
   - GET `/api/accounts/:address`：无 CORS 报错；根据注册情况返回 200/404。
   - POST `/api/media/uploads`：返回 201，响应体可读。
3) 控制台无持续性 `CORS policy` 报错；钱包提示可忽略或后续优化。

## 当前 R1 状态建议
- 完成 CORS 配置（或代理）后，即可将 R1 标记为 “✅ 已实现”。链上事件监听与落库已稳定；前端仅需能访问 BFF。

## 变更方案
已按方案 1 在 BFF 启用了 CORS，允许来自 http://localhost:3000 的前端访问。

  变更

  - apps/bff/src/main.ts
      - 在 NestFactory.create 后调用 app.enableCors(...)，默认允许 origin

  - origin: http://localhost:3000（可配）
  - methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
  - allowedHeaders: content-type, authorization, x-requested-with, x-haigo-
  trace-id
  - exposedHeaders: x-haigo-trace-id
  - credentials: false
