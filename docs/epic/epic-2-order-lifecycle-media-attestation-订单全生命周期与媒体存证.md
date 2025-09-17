# Epic 2: Order Lifecycle & Media Attestation (订单全生命周期与媒体存证)
**目标**：实现订单创建到出库的完整状态机，确保关键节点均有链上事件与链下媒体哈希对照。

## Story 2.1 Order Lifecycle Move Module (订单生命周期 Move 模块)
> 作为合约开发者，我希望实现订单状态机、费用记录与事件模型，让平台可在链上跟踪订单各阶段。

接受标准：
1: 定义 `create_order`、`check_in`、`set_in_storage`、`check_out` 函数与状态字段。
2: 存储费用、快递单号、时间戳、媒体哈希等关键数据。
3: 触发 `OrderCreated`、`CheckedIn`、`SetInStorage`、`CheckedOut` 事件。
4: Move 单元测试覆盖正常流程、非法状态跳转与权限校验。

## Story 2.2 Order Creation & Fee Payment Flow (订单创建与费用支付前端流程)
> 作为商家，我希望在前端选择仓库、填写费用与保险信息并一次性链上支付，以便生成唯一订单记录。

接受标准：
1: UI 支持仓库选择、费用计算（含可配置保险费率）与快递信息填写。
2: 提交交易调用 `create_order`，展示费用拆解与 Gas 预估。
3: 交易成功后显示 `record_uid`、支付哈希与状态提示。
4: 前端调用索引 API 获取订单详情并同步商家订单列表。

## Story 2.3 Inbound Media Upload & Hash Verification (入库媒体上传与哈希验证)
> 作为仓主，我希望在入库时上传照片/视频，生成媒体哈希并上链存证，确保入库证据可信。

接受标准：
1: 入库表单支持上传媒体并本地计算哈希（keccak256/blake3）。
2: 调用 `check_in` 上链记录快递单号、媒体哈希与时间戳。
3: 媒体上传至对象存储并回写元数据，链上哈希保持一致。
4: 前端展示哈希验证状态，支持重复校验并提示成功/失败。

## Story 2.4 Fulfillment & Order Closure (出库与订单闭环)
> 作为仓主或商家，我希望在出库时记录新的物流信息与媒体哈希，使订单生命周期完结并保留证据。

接受标准：
1: 出库流程区分角色权限，输入框体与入库一致。
2: 调用 `check_out`，记录出库单号、媒体哈希与时间戳，状态更新为 `WAREHOUSE_OUT`。
3: 后端监听出库事件并刷新订单索引与统计。
4: 订单详情页展示完整时间线及各节点哈希验证结果。
