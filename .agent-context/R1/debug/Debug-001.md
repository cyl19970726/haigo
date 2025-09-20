# R1 Debug Log – Missing profile hash in event payload

问题摘要
- 现象：BFF 在处理注册事件时反复报错并卡住游标推进。
- 日志：
  ```
  [AccountsEventListener] Failed to process event 6870726028:0
  Error: Missing profile hash value in event payload
  at AccountsEventListener.mapEventToAccount (.../apps/bff/dist/.../event-listener.service.js:288)
  ```
- 影响：相同事件会在每次轮询反复失败，导致注册账号无法入库，前端一直 404。

定位与根因
- 事件来源：Move 模块 `haigo::registry` 的注册事件结构（SellerRegistered / WarehouseRegistered）。字段如下：
  - `address: address`
  - `role: u8`
  - `hash_algorithm: u8`
  - `hash_value: String`
  - `timestamp: u64`
  - `sequence: u64`
- 监听器取值逻辑（锚点）：`apps/bff/src/modules/accounts/event-listener.service.ts:357`
  ```ts
  private extractHashValue(data: Record<string, any>): string | null {
    const hashContainer = data.profile_hash ?? data.profileHash ?? data.hash;
    if (!hashContainer) {
      return typeof data.profile_hash_value === 'string' ? data.profile_hash_value : null;
    }
    if (typeof hashContainer === 'string') return this.ensureLowercaseHash(hashContainer);
    if (typeof hashContainer === 'object') {
      const value = hashContainer.value ?? hashContainer.hash ?? hashContainer.hash_value ?? null;
      return value ? this.ensureLowercaseHash(value) : null;
    }
    return null;
  }
  ```
- 差异：事件里实际字段是 `hash_value`，而代码仅在“兜底”时找 `profile_hash_value`（并不会触发），导致 `extractHashValue` 返回 `null`。
- 结论：字段名不匹配是根因。应支持顶层 `data.hash_value`/`data.hashValue`。

验证（接口/链上）
- Move 代码确认事件结构包含 `hash_value`（见 `move/sources/registry.move`）。
- 如需进一步验证，可用 Indexer GraphQL 查询该版本的事件 `6870726028:0`，确认 `data` 里存在 `hash_value`。

修复方案（已实施）
- 修改 BFF 的取值逻辑，兼容顶层与嵌套两类命名：
  - 直接字符串：`profile_hash` / `profileHash` / `hash` / `hash_value` / `hashValue` / `profile_hash_value`
  - 嵌套对象：从容器的 `value` / `hash` / `hash_value` 读取
- 文件与位置：`apps/bff/src/modules/accounts/event-listener.service.ts:357` 处 `extractHashValue`
- 已完成构建：`pnpm --filter @haigo/bff build`
- 建议补强“毒丸跳过”策略：若仍无法解析哈希，为避免卡死，应记录告警并推进游标（可选）。

修复补丁（摘要）
```ts
private extractHashValue(data: Record<string, any>): string | null {
  const directStr = data.profile_hash ?? data.profileHash ?? data.hash ?? data.hash_value ?? data.hashValue ?? data.profile_hash_value;
  if (typeof directStr === 'string') return this.ensureLowercaseHash(directStr);
  const container = data.profile_hash ?? data.profileHash ?? data.hash;
  if (container && typeof container === 'object') {
    const value = container.value ?? container.hash ?? container.hash_value ?? null;
    return typeof value === 'string' ? this.ensureLowercaseHash(value) : null;
  }
  return null;
}
```

回归与验收
- 步骤：
  1) 重启 BFF：`pnpm --filter @haigo/bff start`
  2) 观察 BFF 日志：不再出现 Missing profile hash 错误；可见“Updating account … from event …”
  3) 前端刷新注册页：`GET /api/accounts/:address` 由 404 → 200
  4) 自动跳转到 `/dashboard/{role}` 正常
- 可选：在 `extractHashValue` 解析失败时将事件打印为 JSON（脱敏）方便追踪。

后续建议
- 将事件字段映射表写入文档 `docs/architecture/data-stream.md` 的 Contract 部分（已补充主要契约）。
- 为关键解析点加上单元测试（mock Indexer payload），覆盖：`profile_hash`/`profileHash`/`hash`/`hash_value` 等分支。
- 监听器在解析异常时推进游标（可控开关），避免单条坏事件阻塞后续数据。

时间线
- 2025-09-19 13:52 发现错误日志，定位到字段不匹配。
- 2025-09-19 13:58 实施修复并完成构建；待运行回归验证。
