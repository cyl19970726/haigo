# O2 实施变更摘要（计划 → 落地核对）

## 代码新增/改动
- OrdersEventListener 扩展解析：CheckedIn/SetInStorage/CheckedOut
- 新增 OrdersTimelineService 与 /api/orders/:recordUid/timeline
- 复用 MediaModule 上传与哈希对账逻辑

## 文档/Anchor 回填
- docs/architecture/10-场景化端到端数据流.md:10.8 验证并回填
- docs/architecture/4-链下服务与数据流.md 扩展订单监听与时间线

## 验收
- 时间线事件与媒体对账 matchedOffchain=true
- 兜底成功与日志记录
