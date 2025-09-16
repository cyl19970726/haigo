# HaiGo 海行 - 海外仓 RWA 产品需求文档（PRD v1.2 / Aptos）

> 本版本重点：明确**关键数据上链**与**大体量媒体链下+哈希上链**的存储策略；补充账户模型、数据结构、状态机与事件、接口与安全合规。

---

## 0. 更新摘要（v1.2）

* **账户与身份**：商家账号、家庭仓账号均在 **Aptos 链上注册与标识**（钱包地址即主标识，可绑定链下资料）。
* **数据上链原则**：**关键业务数据上链**（订单、状态、参与方、费用、快递单号、时间戳、哈希）；**大体量媒体链下**（图片/视频等）并在链上存 **内容哈希**（content hash）。
* **媒体存储**：默认使用 **后端对象存储（S3/MinIO 等）**，链上仅保存哈希与必要元数据，支持后续可验证取证。
* **合约扩展**：细化订单状态机、事件模型、保险与质押合约接口。

---

## 1. 产品概述

**产品名称**：HaiGo 海行
**定位**：基于 **Aptos** 的海外家庭仓 **RWA（Real World Assets）** 平台与区块链供应链基础设施。
**目标**：通过关键数据上链，构建可信的跨境仓储与履约网络，提升**透明度、信用与资金效率**。

**核心价值**：

1. 资产/流程上链：订单全生命周期上链可追溯；
2. 去中心化信用：仓主通过 **APT/USDT 质押** 获得信用背书；
3. 金融化与保险：仓储费 + 保险费合约结算，异常触发理赔逻辑；
4. 全球分布式网络：连接工厂、仓库、物流、销售团队，实现跨境协作。

---

## 2. 角色与目标

### 2.1 商家/卖家

* 通过 Aptos 钱包注册与登录；
* 浏览筛选家庭仓、提交订单并链上支付仓储费与保险费；
* 查看入库/出库状态，评价仓主。

### 2.2 家庭仓/仓主

* 通过 Aptos 钱包注册，提交场地资料、能力标签；
* 设置每件收费、选择质押额度（APT/USDT）；
* 处理订单，入库/出库并上链存证；
* 参与排名/激励。

### 2.3 平台/社区

* 搜索/筛选/点评；
* 激励分配、信用体系、数据透明；
* 安全合规与风控。

---

## 3. 链上与链下数据策略

### 3.1 上链（必须）

* 账户标识：**商家地址、仓主地址**（Aptos 地址为主标识）。
* 订单主信息：record\_uid、选择的仓库、费用结构（仓储费、保险费）、支付 tx hash、状态机状态、关键时间戳。
* 物流要点：入库/出库**快递单号**、对应动作的**内容哈希**（照片/视频/文件的哈希）。
* 质押与信用：质押金额、质押资产类型（APT/USDT）、质押状态。
* 保险：商品申报价值、保费、理赔状态关键字段。

### 3.2 链下（体量大或隐私）

* 图片/视频等媒体文件：**存链下（后端对象存储，如 S3/MinIO）**，链上仅存内容哈希（如 keccak256 / blake3 等）。
* 可选的详细资料：如更细粒度的仓库图片、合规证明扫描件等（同样以哈希上链）。

### 3.3 可验证性

* 前端/服务在展示媒体时，

  1. 拉取链下媒体；
  2. 本地计算哈希与链上哈希比对；
  3. 匹配则显示已验证标识，增强可信。

---

## 4. 账户与身份模型

* **主标识**：Aptos 钱包地址（seller\_address / warehouse\_address）。
* **链下扩展档案**：昵称、联系方式、地理位置、能力标签等（保存于链下；其摘要哈希上链）。
* **权限最小化**：所有状态变更由对应权利人地址提交交易（或由其授权的运营密钥/多签）。

---

## 5. 功能模块与流程

### 5.1 注册/登录

* 连接 Aptos 钱包 → 选择身份（商家 / 仓主）→ 提交链下资料（hash 上链）。

### 5.2 Listing/筛选

* 严选仓库卡片：地区、价格、评分、质押额度、发货速度、容量标签。

### 5.3 下单（链上创建记录）

1. 卖家在 Listing 选择有可用额度的家庭仓；
2. 填写 **快递信息、商品价值、保险金额**（保费=价值×1%）；
3. 通过 Aptos 合约**一次性支付**：仓储费 + 保险费；
4. 生成 `record_uid` 与 `ORDER_CREATED` 状态上链。

### 5.4 入库（上链存证）

* 家庭仓收到快递 → 拍照入库；
* 写入：入库快递单号、入库照片哈希（媒体链下）、时间戳；
* 状态：`WAREHOUSE_IN`。

### 5.5 仓储中

* 维持 `IN_STORAGE`；异常触发保险流程（详见 §8）。

### 5.6 出库（上链存证）

* 卖家售出后填入 USPS 等出库单号；
* 仓库执行出库 → 拍照出库 → 上链记录出库单号、照片哈希、时间戳；
* 状态：`WAREHOUSE_OUT`（订单闭环）。

---

## 6. 订单状态机（链上）

```
ORDER_CREATED → WAREHOUSE_IN → IN_STORAGE → WAREHOUSE_OUT
```

* 每次变更产生事件（Event）并写入区块。

**状态字段（示例）**：`0=CREATED, 1=IN, 2=STORAGE, 3=OUT`。

---

## 7. 数据模型（示例）

> 具体以 Move 结构实现，以下为抽象字段说明。

**WarehouseRecord**

* record\_uid: string
* seller\_address: address
* warehouse\_address: address
* status: u8
* fees: { storage\_fee: u64, insurance\_fee: u64 }
* value\_declared: u64
* payment\_tx\_hash: string
* timestamps: { created: u64, in?: u64, out?: u64 }
* logistics: \[

  * { action: "IN", tracking\_no: string, media\_hash: string, ts: u64 },
  * { action: "OUT", tracking\_no: string, media\_hash: string, ts: u64 }
    ]
* meta\_hash: string  // 订单补充信息摘要（可选）

**StakeInfo**

* warehouse\_address: address
* amount: u64
* asset: string  // APT/USDT
* active: bool

**InsurancePolicy**

* record\_uid: string
* declared\_value: u64
* premium\_rate\_bp: u16  // 100 = 1%
* premium\_paid: u64
* claim\_status: u8  // 0=none,1=opened,2=approved,3=rejected,4=paid

---

## 8. 保险机制

* 保费=申报价值×1%（基点可配置）；
* 异常（丢失/损毁）→ 开启理赔：

  1. 由卖家或平台提交**链下证据哈希**；
  2. 保险合约/仲裁流程判定；
  3. 审批事件上链，若通过则按约定赔付。

---

## 9. 质押与激励

* 仓主质押 APT/USDT 获得信用权重；
* 排名= f(服务质量、评分、质押额度)；
* 激励：按订单完成度、履约质量与平台权重发放（具体 Tokenomics 另行定义）。

---

## 10. 合约接口（概要）

> 以 Move Module 表达；实际接口与权限在开发阶段细化。

* `register_seller(address, meta_hash)`
* `register_warehouse(address, meta_hash, base_fee, capacity_tags)`
* `stake(address, amount, asset)` / `unstake(address, amount)`
* `create_order(seller, warehouse, value_declared, storage_fee, insurance_fee, payment_tx_hash) -> record_uid`
* `check_in(record_uid, in_tracking_no, media_hash)`
* `set_in_storage(record_uid)`
* `check_out(record_uid, out_tracking_no, media_hash)`
* `open_claim(record_uid, evidence_hash)` / `resolve_claim(record_uid, decision, payout)`
* `rate_warehouse(record_uid, score, review_hash)`

**事件（Events）**：

* `OrderCreated`, `CheckedIn`, `SetInStorage`, `CheckedOut`, `StakeChanged`, `ClaimOpened`, `ClaimResolved`, `WarehouseRated`。

---

## 11. 前端与后端接口

* 前端与钱包：Aptos 钱包适配（e.g. Petra 等），交易签名与事件监听；
* BFF/Indexing：监听链上事件，聚合生成可视化数据（地图分布、统计、排行榜）；
* 媒体存储：上传至对象存储（S3/MinIO）→ 返回哈希 → 写入链上。

---

## 12. 安全、隐私与合规

* **安全**：合约审计；关键函数权限控制；重放/签名校验；
* **隐私**：仅将必要摘要上链；个人敏感信息链下存储并最小化展示；
* **合规**：各国仓储/物流监管要求；KYC/AML（如未来引入法币出入金）。

---

## 13. 性能与成本

* 事件驱动的 **轻量上链**（只存关键字段与哈希）以控制 Gas；
* 使用索引服务加速查询；
* 媒体链下，提高吞吐与成本可控性。

---

## 14. 运维与监控

* 合约与节点健康检查；
* 事件滞后与失败重试；
* 媒体哈希校验失败报警、订单状态异常报警。

---

## 15. 里程碑（建议）

* **MVP（4–6 周）**：注册/质押/下单/入库/出库 + 媒体哈希上链；
* **Beta（+6–8 周）**：保险理赔、评分系统、榜单/地图；
* **v1.0（+8–10 周）**：多资产支持、风控策略、审计与上线。

---

## 16. KPI（示例）

* 月活仓库数/商家数、订单完成率、入库→出库平均时长、理赔率、媒体哈希校验通过率、索赔处理时长。

---

## 17. 附录：术语

* **Content Hash**：媒体内容的加密摘要，用于链上对照验证；
* **Record UID**：订单的唯一标识；
* **Meta Hash**：链下扩展资料的摘要；
* **Stake**：质押；**Claim**：理赔。
