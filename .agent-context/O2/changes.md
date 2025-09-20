# O2 实施变更摘要（计划 → 落地核对）

## 代码新增/改动（对齐现状）
- [ ] OrdersEventListener 扩展解析：CheckedIn/SetInStorage/CheckedOut（可改为 _in 查询多事件类型）
- [ ] OrdersRepository / OrdersService：
  - getDetail 补充 timeline 阶段映射（CREATED/WAREHOUSE_IN/IN_STORAGE/WAREHOUSE_OUT），附带媒体摘要
  - 对账 matchedOffchain：media_assets.hash_value == event.media.hash（在入库或读取时完成）
- [ ] 复用 MediaModule 上传与哈希对账逻辑
- [ ]（可选）若未来拆分时间线端点：新增 GET /api/orders/:recordUid/timeline

## 文档/Anchor 回填
- docs/architecture/10-场景化端到端数据流.md:10.8 验证并回填
- docs/architecture/4-链下服务与数据流.md 扩展订单监听与时间线

## 验收
- 时间线事件与媒体对账 matchedOffchain=true
- 兜底成功与日志记录
- 路由打通：`/(warehouse)/orders/[recordUid]/check-out` 页面可完成上传与签署
