# W2 变更摘要与验收

## 代码
- [ ] 扩展 OrdersController.list 支持 `?warehouse=0x...` 查询参数（与 `?seller=0x...` 互斥）
- [ ] OrdersService.listSummaries 与 OrdersRepository.listSummaries 接受 `{ sellerAddress?, warehouseAddress? }` 并据此过滤
- [ ] Repo 查询按 `createdAt desc` 排序；必要时补充状态聚合 counts（可选）

## 验收
- 列表过滤与排序正确
