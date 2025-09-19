# W2 家庭仓订单收件箱（可见性） — 实施计划

## 目标
- 家庭仓可在订单列表看到被下单的订单（待处理/在库/已出库）。

## 步骤
1) 扩展 OrdersController.list：支持 `?warehouse=0x...` 过滤
2) FE：`WarehouseOrders` 页面；按状态分组显示

## 测试
- 列表过滤正确；状态映射一致

## 验收
- /api/orders?warehouse= 地址返回对应订单
