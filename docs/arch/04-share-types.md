# Share Types

共享类型定义在 `packages/shared` 包，为前端、BFF 与脚本提供统一的数据契约。本节列出当前已实现的结构体、事件映射与常量，并指出未来扩展的目标路径。

## Registry Entities & Events
- 代码来源：`packages/shared/src/dto/registry.ts`。
- 消费方：
  - BFF 通过 `apps/bff/src/modules/accounts/accounts.repository.ts:84` 将 Indexer 事件映射成 `AccountRecord`。
  - REST API `GET /api/accounts/:address` 在 `apps/bff/src/modules/accounts/accounts.service.ts:26` 组装 `AccountProfile` 供前端查询。
  - 前端 `RegisterView` (`apps/web/features/registration/RegisterView.tsx:602`) 将注册结果映射成 `AccountProfile`。

```ts
// packages/shared/src/dto/registry.ts
export interface AccountRecord {
  address: string;
  role: number; // ROLE_SELLER = 1, ROLE_WAREHOUSE = 2
  hashAlgorithm: number; // HASH_ALGORITHM_BLAKE3 = 1
  hashValue: string; // 64-character lowercase hex string
  timestamp: number; // Unix timestamp in seconds
}

export interface SellerRegisteredEvent {
  address: string;
  role: number; // Always ROLE_SELLER = 1
  hashAlgorithm: number; // HASH_ALGORITHM_BLAKE3 = 1
  hashValue: string;
  timestamp: number;
  sequence: number;
}

export type RegistryEvent = SellerRegisteredEvent | WarehouseRegisteredEvent;

export interface AccountProfile {
  address: string;
  role: 'seller' | 'warehouse';
  profileHash: { algo: 'blake3'; value: string };
  profileUri?: string;
  registeredAt: string;
  orderCount?: number;
}
```

> **Future anchors**：平台运营角色与更多事件类型将在 `packages/shared/src/dto/registry-platform.ts (planned)` 中扩展，保持与 Move `PlatformOperatorRegistered` 事件同步。

## Order Domain & Media Types
- 代码来源：`packages/shared/src/dto/orders.ts` 与 `packages/shared/src/config/orders.ts`。
- 已消费：
  - 前端订单工具 `apps/web/features/orders/utils.ts:7`。
  - 媒体上传返回体 `apps/bff/src/modules/media/media.service.ts:102`。
- 规划消费：`apps/bff/src/modules/orders/`（planned）将以这些结构作为 API 契约。

```ts
// packages/shared/src/dto/orders.ts
export interface OrderSummaryDto {
  recordUid: string;
  orderId: number;
  status: 'CREATED' | 'WAREHOUSE_IN' | 'IN_STORAGE' | 'WAREHOUSE_OUT' | 'PENDING';
  warehouseAddress: string;
  pricing: PricingBreakdown;
  logistics?: LogisticsInfo;
  createdAt: string;
  updatedAt?: string;
  transactionHash?: string;
}

export interface OrderMediaAsset {
  id?: string;
  recordUid?: string;
  stage: OrderMediaStage;
  category: string;
  hashValue: string;
  hashAlgorithm: OrderMediaHashAlgorithm;
  crossCheckHashAlgorithm?: OrderMediaHashAlgorithm;
  crossCheckHashValue?: string;
  sizeBytes?: number;
  mimeType?: string;
  storagePath?: string;
  path?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  matchedOffchain?: boolean;
  verificationStatus?: OrderMediaVerificationStatus;
  hash?: { algo: string; value: string };
}

export const calculatePricing = ({
  amountApt,
  insuranceRateBps,
  platformFeeBps
}: PricingFormValues): PricingBreakdown => {
  const amountSubunits = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
  const insuranceFeeSubunits = Math.max(Math.round((amountSubunits * insuranceRateBps) / 10_000), 0);
  const platformFeeSubunits = Math.max(Math.round((amountSubunits * platformFeeBps) / 10_000), 0);
  const totalSubunits = amountSubunits + insuranceFeeSubunits + platformFeeSubunits;

  return {
    amountSubunits,
    insuranceFeeSubunits,
    platformFeeSubunits,
    totalSubunits,
    currency: 'APT',
    precision: OCTA_PER_APT
  };
};
```

```ts
// packages/shared/src/config/orders.ts
export const ORDER_MEDIA_STAGES = {
  CREATED: 'created',
  INBOUND: 'inbound',
  STORAGE: 'storage',
  OUTBOUND: 'outbound'
} as const;

export const ORDER_MEDIA_ERROR_CODES = {
  MIME_NOT_ALLOWED: 'MEDIA_MIME_NOT_ALLOWED',
  SIZE_EXCEEDED: 'MEDIA_SIZE_EXCEEDED',
  HASH_MISMATCH: 'MEDIA_HASH_MISMATCH',
  UPLOAD_FAILED: 'MEDIA_UPLOAD_FAILED'
} as const;
```

> **Future anchors**：订单时间线事件 DTO 计划放置在 `packages/shared/src/dto/orders-events.ts (planned)`，与 Move `OrderCreated`/`CheckedIn` 事件字段保持一致。

## Network & Module Configuration
- 代码来源：`packages/shared/src/config/aptos.ts`。
- 使用者：
  - 前端 `RegisterView` (`apps/web/features/registration/RegisterView.tsx:425`)。
  - Move 部署脚本与 BFF 配置同步。

```ts
// packages/shared/src/config/aptos.ts
export interface AptosConfig {
  network: string;
  nodeUrl: string;
  faucetUrl?: string;
  modules: {
    registry: string;
    orders: string;
  };
}

export const APTOS_CONFIG_DEV: AptosConfig = {
  network: 'devnet',
  nodeUrl: 'https://fullnode.devnet.aptoslabs.com/v1',
  faucetUrl: 'https://faucet.devnet.aptoslabs.com',
  modules: {
    registry: '0xA11CE',
    orders: '0xA11CE'
  }
};

export const getAptosConfig = (): AptosConfig => {
  const env = process.env.APTOS_NETWORK || process.env.NODE_ENV || 'development';
  switch (env) {
    case 'mainnet':
    case 'production':
      return APTOS_CONFIG_MAINNET;
    case 'testnet':
    case 'test':
      return APTOS_CONFIG_TESTNET;
    default:
      return APTOS_CONFIG_DEV;
  }
};
```

未来部署后需更新 `modules.registry`/`modules.orders`，并同步 `apps/bff/src/common/configuration.ts` 中的默认值。

## GraphQL Utilities
- `packages/shared/src/gql/index.ts` 提供共享 GraphQL 片段。当前示例用于测试结构，后续可放置订单与理赔查询。

```ts
export const SAMPLE_QUERY = /* GraphQL */ `
  query SampleQuery {
    account {
      address
    }
  }
`;
```

## API Alignment
| 模块 | 已实现 API | 数据结构 |
|------|------------|----------|
| Accounts | `GET /api/accounts/:address`（`apps/bff/src/modules/accounts/accounts.controller.ts:24`） | `AccountProfile` |
| Accounts | `POST /api/accounts/:address/verify-hash`（`apps/bff/src/modules/accounts/accounts.controller.ts:41`） | `AccountProfile` + hash 对比结果 |
| Media | `POST /api/media/uploads`（`apps/bff/src/modules/media/media.controller.ts:24`） | `OrderMediaAsset` |
| Orders (planned) | `/api/orders/*`（`apps/bff/src/modules/orders/`） | `OrderSummaryDto`, `OrderMediaAsset` |
| Claims (planned) | `/api/claims/*`（`apps/bff/src/modules/claims/`） | `ClaimSummaryDto (planned)` |

> 规划中的 DTO 将新增在：`packages/shared/src/dto/claims.ts (planned)` 与 `packages/shared/src/dto/credit.ts (planned)`，并在对应 BFF 模块交付时补充。

## Distribution & Build
- ESM 导出入口：`packages/shared/src/index.ts`。
- 构建命令：`pnpm --filter @haigo/shared build`（确保 `dist/` 同步，供 BFF/前端生产使用）。
- `packages/shared/package.json` 使用 `exports` 字段区分 `src/` 与 `dist/`，开发环境通过 `tsconfig` paths 指向源码。

保持文档与代码同步：新增或调整 DTO 时，必须更新此文件、相关 API 列表以及 `docs/arch/03-data-flows.md` 的锚点。
