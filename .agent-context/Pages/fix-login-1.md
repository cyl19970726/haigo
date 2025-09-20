# fix-login-1.md — Current Login Failure Investigation Notes

## 1. 后端（BFF）日志摘录
```
[Nest] 34152  - 09/19/2025, 5:58:40 PM   ERROR [StakingListener] Staking poll failed
Error: Indexer responded 408: {"errors":[{"message":"Request Timed Out: Upstream took longer than 10000ms to respond","extensions":{"code":"408"}}]}
    at StakingListener.fetchEvents (.../apps/bff/dist/apps/bff/src/modules/staking/staking.listener.js:146:19)
    at async StakingListener.pollOnce (...staking.listener.js:104:32)
[Nest] 34152  - 09/19/2025, 6:00:52 PM    WARN [AccountsService] Hasura order count fetch failed: Missing 'Authorization' or 'Cookie' header in JWT authentication mode
[Nest] 34152  - 09/19/2025, 6:00:54 PM    WARN [AuthSessionService] Signature verification failed: r.startsWith is not a function
...
[Nest] 34152  - 09/19/2025, 6:02:36 PM    WARN [AuthSessionService] Signature verification failed: r.startsWith is not a function
[Nest] 34152  - 09/19/2025, 6:02:40 PM   ERROR [StakingListener] Staking poll failed (same 408 timeout)
```

### 1.1 StakingListener 408（Indexer 超时）
- **含义**：从 Aptos Indexer 拉取质押事件超过 10s，被上游返回 408。
- **影响**：质押缓存同步失败，对登录流程无直接影响，但错误频繁会掩盖核心日志。
- **处理建议**：检查 `indexerUrl` 配置，可调大 `ingestion.pollingIntervalMs`、增加退避。

### 1.2 AccountsService Hasura 鉴权缺失
- **报错**：`Missing 'Authorization' or 'Cookie' header in JWT authentication mode`。
- **可能原因**：BFF 请求 Hasura 缺少 `HASURA_ADMIN_SECRET` 或有效 JWT。
- **风险**：注册成功后的订单统计/派生字段无法写回，影响仪表盘和登录后的数据展示。

### 1.3 AuthSessionService 签名校验失败（`r.startsWith is not a function`）
- **现象**：`/api/session/verify` 调用中，`Ed25519PublicKey(publicKey)` 构造函数对 `publicKey` 调用 `.startsWith`，但该值是对象/字节数组而非字符串。
- **结论**：前端 fallback 的 `accountPublicKey` 为 `Uint8Array`；BFF 期望 0x 开头的十六进制字符串。
- **影响**：签名校验未通过 → 401 → 登录失败。

## 2. 前端日志摘录
```
GET http://localhost:3001/api/session/profile 401 (Unauthorized)
POST http://localhost:3001/api/session/verify 401 (Unauthorized)
```
- 均来自 `apps/web/lib/session/ensureSession.ts`。
- 与 1.3 所述后端错误一致；失败后前端继续轮询 profile，导致 401 日志刷屏。

## 3. 当前状态总结
- 钱包可正常连接，注册状态拉取也能完成，但会话签名校验阶段因 `publicKey`/`signature` 格式不正确被拒绝。
- Hasura 鉴权&Indexer 超时是并发存在的噪声问题，需要在修复登录后并行治理。

## 4. 修复策略：统一签名负载格式

### 4.1 前端（主要改动）
- 在 `apps/web/lib/session/ensureSession.ts` 中加入 `toHexString` 工具，接受 `string | Uint8Array | { toString() }`，输出小写、`0x` 前缀的十六进制字符串。
- 对 `signature.signature`、`publicKey`、fallback `accountPublicKey` 均调用该工具后再请求 `/api/session/verify`。
- 注册流程的签名/公钥传参也同步使用相同工具，保持行为一致。

### 4.2 后端（增强容错）
- 在 `AuthSessionService.verifyChallenge` 中临时记录 payload 类型，确认修复效果。
- 若收到非字符串/空值，直接抛出 400 并提示“Invalid public key format”以便前端识别。
- （可选）把 `Ed25519PublicKey`、`Ed25519Signature` 构造包装成 try/catch，并输出具体 invalid hex 错误。

### 4.3 验证步骤
1. `curl` `/api/session/challenge` 获取 nonce。
2. 使用钱包签名，确认返回的是十六进制字符串/Uint8Array。
3. `curl` `/api/session/verify`，期待 200 + `sessionId`。
4. 前端刷新后不再出现 401，能跳转仪表盘。

## 5. 其它环境问题（并行跟踪）
1. **Hasura JWT 警告**：修复 BFF → Hasura 请求头；否则注册后统计数据缺失。
2. **Indexer 408**：调大轮询间隔、增加退避或切换 API Key，避免日志噪声。

## 6. 实施步骤（登陆热修分支）
1. 在 `ensureSession.ts` / 注册视图中实现 `toHexString` 并归一化 payload。
2. （已完成）前端 `apps/web/lib/session/ensureSession.ts` 新增 `toHexString`，支持 `string | Uint8Array | object.toString()`，并在调用 `/api/session/verify` 前统一转换为 `0x` 前缀小写十六进制。
3. （待确认）临时加强后端日志，验证 payload 类型；部署后移除。
4. 手工回归登录：网络匹配、签名、后端联通、仪表盘跳转。
5. 回归注册流程，确保仍能落库。
6. 修正 Hasura/Indexer 配置（独立任务）。

### 6.1 最新代码变更概览（2025-09-19）
- 文件：`apps/web/lib/session/ensureSession.ts`
  - 引入 `HEX_PREFIX`、`toHexString` 辅助函数，将钱包返回的 `Uint8Array` 或大小写不一的十六进制字符串统一成 `0x` 开头的小写十六进制；字符串长度不足或非偶数时视为无效。
  - `publicKey` 先尝试使用钱包返回值，若不存在则回退到 `accountPublicKey`，最终都经过 `toHexString` 归一化。
  - `signature` 支持多种 shape（`{ signature: '0x…' }`、`Uint8Array`、`string`），统一转换后再传给 BFF。
  - 归一化失败仍抛出 `Wallet did not return a login signature.`，提示用户重试。
- 运行 `pnpm --filter @haigo/web lint`，确认无 ESLint 错误。

## 7. 决策门槛
- ✅ 若签名归一化恢复 200/Redirect，则可继续执行首页/登录分离计划（`login.md`）。
- ❌ 若仍失败，收集最新 payload/日志，考虑钱包适配器版本或 Aptos SDK 回退。

---

## 8. 数据流梳理（注册→数据库→登录验证）

### 8.1 注册上链时合约写入的数据
- 模块：`move/sources/registry.move`
  - `Registry` 全局资源维护两种关键结构：
    - `accounts: Table<address, AccountRecord>`：以钱包地址为键存储 `AccountRecord`。
    - 三个事件句柄（SellerRegistered / WarehouseRegistered / PlatformOperatorRegistered）。
  - `AccountRecord` 字段：
    - `address`：注册者地址（`address`）。
    - `role`：角色枚举（1=卖家，2=仓库，4=平台）。
    - `hash_algorithm`：目前固定为 `1`（BLAKE3）。
    - `hash_value`：64 位小写 hex，代表身份资料文件的 BLAKE3 Hash。
    - `timestamp`：`timestamp::now_seconds()` 记录链上时间。
  - `register_seller` / `register_warehouse` / `register_platform_operator`：
    - 检查是否已存在记录、哈希格式是否符合要求。
    - 写入 `accounts` 表，并各自 emit 对应事件。事件字段包含 `address/role/hash_algorithm/hash_value/timestamp/sequence`。
- 因此：只要注册成功，链上数据 = (地址, 角色, 哈希算法=blake3, 哈希值, 时间戳)，并伴随事件供 off-chain 消费。

### 8.2 BFF 侧数据库持久化
- 模块：`apps/bff/src/modules/accounts`
  - `AccountsEventListener` 轮询 Aptos Indexer (`events` GraphQL)：
    - 监听 `${MODULE}::registry::SellerRegistered` & `WarehouseRegistered`。
    - 读取 `transaction_version`、`event_index`、`account_address`、事件数据。
    - 通过 `AccountsRepository.upsertFromEvent` 写入 Postgres。
  - 数据落入 `prisma.schema` 的 `accounts` 表（字段映射如下）：
    - `account_address`（主键）：钱包地址，小写 0x 字符串。
    - `role`：枚举 `seller` / `warehouse`。
    - `profile_hash_algo`：当前固定 `blake3`。
    - `profile_hash_value`：与链上哈希一致。
    - `profile_uri`：可选字段（注册表单上传的资料在对象存储地址，事件中不存在，由 BFF 后续回填）。
    - `registered_by`：触发交易的 signer 地址。
    - `txn_version` / `event_index`：光标，用于防止重复或乱序写入。
    - `txn_hash`、`chain_timestamp`：从 fullnode REST 查询补全。
    - `created_at` / `updated_at`：数据库时间戳。
- 这个 accounts 表就是登录阶段 `AccountsService.getAccountProfile` 返回的权威数据源。

### 8.3 登录验证流程
1. **前端发起**（`apps/web/app/page.tsx` / `ensureSession.ts`）：
   - 若钱包地址已在上述 accounts 表中查到记录（`useAccountRegistration` 轮询 BFF `/api/accounts/:address`），进入登录阶段。
   - 调用 `/api/session/challenge`：BFF 依据地址发放 `nonce` 和规范化 challenge 文本。
   - 使用钱包 `signMessage({ message, nonce, address:false, application:false, chainId:false })`。
     - 不同钱包可能返回：
       ```ts
       {
         signature: '0x…' | Uint8Array | { signature: '0x…' },
         publicKey?: '0x…' | Uint8Array,
         fullMessage?: 'APTOS\n{"message":...,"nonce":...}'
       }
       ```
   - 前端归一化上述字段为小写 0x 字符串（关键修复点），随后 POST `/api/session/verify`，携带：
     - `address`: 0x 小写地址
     - `publicKey`: 0x 公钥（若钱包缺省则使用 `accountPublicKey` 回退后再归一化）
     - `signature`: 0x 签名
     - `fullMessage`: 如果钱包返回，直接透传；否则 BFF 将按规范自己拼装。

2. **BFF 校验**（`AuthSessionService.verifyChallenge`）：
   - 读取 challenge map，确认 nonce 未过期。
   - 使用 `Ed25519PublicKey(publicKey)` + `authKey().derivedAddress()` 比对地址 → 确认该公钥确属此账户。
   - `Ed25519Signature(signature)` + `verifySignature({ message: fullMessage or APTOS\n... })` 校验签名本身。
   - 通过后：
     - 调用 `AccountsService.getAccountProfile` 读取数据库记录，并返回给前端。
     - 生成 `sessionId`（UUID），写入内存级 `sessions` Map（address + 过期时间）。

3. **Cookie 同步**：
   - BFF 响应体中携带 `sessionId`；前端随后命中 `apps/web/lib/session/ensureSession.ts` 内的 `/api/dev/session/sync`（Next.js API route）把 `sessionId` 写入同域 HttpOnly Cookie（开发环境兼容 `document.cookie` fallback）。
   - 之后调用 `/api/session/profile` 应返回 200 + 账户档案，SSR 的 `dashboard/layout.tsx` 也能在服务端读取 cookie 并加载 profile。

4. **数据库数据在登录阶段的作用**：
   - `profile.hash_value`、`role` 决定跳转路径（Seller vs Warehouse）。
   - 若数据库无此地址（注册未完成或轮询未入库），登录会停留在“未注册”状态。
   - 任何注册信息更新（如新的 profileUri）也会通过账户轮询在用户下次登录时生效。

5. **失败场景**：
   - `publicKey`/`signature` 非 hex → 触发本文最初的 `r.startsWith` 错误，导致 401。
   - Challenge 过期或被重复消费 → BFF 返回 401 “Challenge not found or expired”。
   - BFF 未能同步 session cookie（开发环境 `fetch('/api/dev/session/sync')` 失败）→ 前端访问 `/api/session/profile` 仍 401；此时前端会提示“Session verification failed”。

综上，注册数据链路为：链上 `Registry.accounts + Seller/WarehouseRegistered 事件` → Indexer GraphQL → BFF 轮询入库 `accounts` 表 → 登录时 `AccountsService` 提供 profile。登录验证完全依赖钱包签名 + 后端对签名的 Ed25519 校验，并不直接同链上交互，但必须依赖数据库里的注册结果。修复登录需要保证签名 payload 与 BFF 期望的数据类型一致。
