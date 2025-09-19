# BFF

## Module Overview
| 模块 | 职责 | Anchor |
|------|------|--------|
| AppModule | 聚合配置、Prisma、业务模块 | `apps/bff/src/modules/app.module.ts:9` |
| Accounts | 上链注册档案查询、哈希校验、Indexer 轮询 | `apps/bff/src/modules/accounts/accounts.controller.ts:24`, `apps/bff/src/modules/accounts/accounts.service.ts:26`, `apps/bff/src/modules/accounts/event-listener.service.ts:125` |
| Media | 媒体上传、哈希验证、存储落地 | `apps/bff/src/modules/media/media.controller.ts:24`, `apps/bff/src/modules/media/media.service.ts:33`, `apps/bff/src/modules/media/media.storage.ts:36` |
| Health | 健康检查 | `apps/bff/src/modules/health/health.controller.ts:4` |
| Infrastructure | Prisma 客户端与配置 | `apps/bff/src/infrastructure/prisma/prisma.module.ts:5`, `apps/bff/src/infrastructure/prisma/prisma.service.ts:6` |

## Accounts Flow
1. 控制器暴露 `GET /api/accounts/:address` 与 `POST /api/accounts/:address/verify-hash`（`apps/bff/src/modules/accounts/accounts.controller.ts:24`, `apps/bff/src/modules/accounts/accounts.controller.ts:41`）。
2. 服务层调用 Prisma 并触发 Hasura 聚合查询（`apps/bff/src/modules/accounts/accounts.service.ts:26`, `apps/bff/src/modules/accounts/accounts.service.ts:87`）。
3. Indexer 轮询器维护游标并 upsert 账户（`apps/bff/src/modules/accounts/event-listener.service.ts:125`, `apps/bff/src/modules/accounts/event-listener.service.ts:176`）。
4. Prisma 模型定义唯一约束确保事件顺序（`apps/bff/prisma/schema.prisma:15`, `apps/bff/prisma/schema.prisma:29`）。

```ts
// apps/bff/src/modules/accounts/accounts.controller.ts:24
@Controller('api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get(':address')
  async getAccountProfile(@Param('address') address: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { requestId, timestamp, traceId } = this.createResponseMeta(req);
    res.setHeader('x-haigo-trace-id', traceId);
    const profile = await this.accountsService.getAccountProfile(address);
    return { data: profile, meta: this.buildMeta(requestId, timestamp) };
  }

  @Post(':address/verify-hash')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  async verifyAccountHash(
    @Param('address') address: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!file) {
      throw new BadRequestException('Verification file is required');
    }
    const { requestId, timestamp, traceId } = this.createResponseMeta(req);
    res.setHeader('x-haigo-trace-id', traceId);
    const result = await this.accountsService.verifyProfileHash(address, file);
    return {
      data: {
        address: address.toLowerCase(),
        verified: result.verified,
        computedHash: result.computedHash,
        storedHash: result.storedHash,
        checkedAt: new Date().toISOString()
      },
      meta: this.buildMeta(requestId, timestamp)
    };
  }
}
```

```ts
// apps/bff/src/modules/accounts/accounts.service.ts:26
async getAccountProfile(address: string): Promise<AccountProfile> {
  const normalizedAddress = this.normalizeAddress(address);
  if (!normalizedAddress) {
    throw new BadRequestException('Invalid account address');
  }

  const account = await this.accountsRepository.findByAddress(normalizedAddress);
  if (!account) {
    throw new NotFoundException(`Account ${normalizedAddress} not found`);
  }

  const profile: AccountProfile = {
    address: normalizedAddress,
    role: this.toLiteralRole(account.role),
    profileHash: { algo: 'blake3', value: account.profileHashValue },
    profileUri: account.profileUri ?? undefined,
    registeredAt: account.chainTimestamp.toISOString()
  };

  try {
    const orderCounts = await this.fetchOrderCount(normalizedAddress);
    if (orderCounts) {
      profile.orderCount = profile.role === 'seller' ? orderCounts.sellerCount : orderCounts.warehouseCount;
    }
  } catch (error) {
    this.logger.warn(`Failed to fetch order counts for ${normalizedAddress}: ${this.stringifyError(error)}`);
  }

  return profile;
}
```

```ts
// apps/bff/src/modules/accounts/event-listener.service.ts:176
private async processEvent(event: RegistrationEventRecord): Promise<void> {
  try {
    const accountInput = this.mapEventToAccount(event);
    await this.accountsRepository.upsertFromEvent(accountInput);
    this.lastTxnVersion = accountInput.txnVersion;
    this.lastEventIndex = accountInput.eventIndex;
  } catch (error) {
    this.logger.error(
      `Failed to process event ${event.transaction_version}:${event.event_index}`,
      error instanceof Error ? error.stack : error
    );
  }
}
```

## Media Flow
1. 上传接口使用 `FileFieldsInterceptor` 接受 `file/media` 字段（`apps/bff/src/modules/media/media.controller.ts:24`）。
2. 服务层执行哈希校验与 MIME 过滤（`apps/bff/src/modules/media/media.service.ts:61`, `apps/bff/src/modules/media/media.service.ts:177`）。
3. 文件落库并写入磁盘（`apps/bff/src/modules/media/media.storage.ts:36`），Prisma 记录资产元数据（`apps/bff/src/modules/media/media.repository.ts:23`）。
4. 错误对齐共享常量 `ORDER_MEDIA_ERROR_CODES`（`packages/shared/src/config/orders.ts:50`）。

```ts
// apps/bff/src/modules/media/media.service.ts:33
async handleUpload(
  file: Express.Multer.File | undefined,
  rawBody: RawUploadMediaBody
): Promise<OrderMediaAsset & { recordUid: string; path: string; hash: { algo: string; value: string } }> {
  if (!file) {
    throw new BadRequestException('Upload file is required');
  }

  const body = this.normalizeBody(rawBody);
  if (!body.recordUid) {
    throw new BadRequestException('record_uid is required');
  }

  const normalizedHashAlgorithm = this.normalizeHashAlgorithm(body.hashAlgorithm);
  if (body.hashAlgorithm && !normalizedHashAlgorithm) {
    throw new BadRequestException('Unsupported hash algorithm');
  }

  const normalizedStage = this.normalizeStage(body.stage);
  const normalizedCategory = body.category ? body.category.toLowerCase() : undefined;
  this.assertFileAllowed(file);

  const computedHash = this.computeBlake3(file.buffer);
  if (body.hashValue) {
    const normalizedExpected = this.normalizeHash(body.hashValue);
    if (computedHash !== normalizedExpected) {
      throw new BadRequestException({
        message: 'Hash mismatch between client and server',
        code: ORDER_MEDIA_ERROR_CODES.HASH_MISMATCH
      });
    }
  }

  const stored = await this.storage.save({
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    recordUid: body.recordUid,
    stage: normalizedStage,
    category: normalizedCategory
  });

  const stage = normalizedStage ?? ORDER_MEDIA_STAGES.INBOUND;
  const category = normalizedCategory ?? this.resolveCategory(file.mimetype);
  const uploadedAt = new Date();

  await this.repository.recordUpload({
    recordUid: body.recordUid,
    stage,
    category,
    storagePath: stored.storagePath,
    publicPath: stored.publicPath,
    hashAlgo: ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
    hashValue: computedHash,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    uploadedBy: body.address,
    uploadedAt
  });

  return {
    recordUid: body.recordUid,
    stage,
    category,
    hashAlgorithm: normalizedHashAlgorithm ?? ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
    hashValue: computedHash,
    crossCheckHashAlgorithm: body.crossCheckHashAlgorithm ? this.normalizeHashAlgorithm(body.crossCheckHashAlgorithm) : undefined,
    crossCheckHashValue: body.crossCheckHashValue ? this.normalizeHash(body.crossCheckHashValue) : undefined,
    sizeBytes: file.size,
    mimeType: file.mimetype,
    storagePath: stored.storagePath,
    path: stored.publicPath,
    uploadedBy: body.address,
    uploadedAt: uploadedAt.toISOString(),
    matchedOffchain: false,
    verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING,
    hash: { algo: ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3, value: computedHash }
  };
}
```

## Configuration & Bootstrapping
- `main.ts` 负责创建 Nest 应用并监听 3001 端口（`apps/bff/src/main.ts:6`）。
- 全局配置从 `.env` 映射（`apps/bff/src/common/configuration.ts:1`）。
- PrismaService 根据配置建立连接并在生命周期钩子中维护（`apps/bff/src/infrastructure/prisma/prisma.service.ts:20`）。

## Planned Modules
- Orders：REST + 轮询模块将新增于 `apps/bff/src/modules/orders/`，包含 `orders.controller.ts (planned)`、`orders.service.ts (planned)`、`orders.event-listener.ts (planned)`。
- Claims：理赔 API/队列位于 `apps/bff/src/modules/claims/`，对接未来 insurance 模块。
- Notifications：运维告警计划落地在 `apps/bff/src/modules/notifications/`，与监控平台集成。

## Testing & Tooling
- Jest/Vitest stub 可在 `apps/bff/package.json:14` 激活；编写单测时应 mock Prisma 与 Indexer 调用。
- Prisma migration 需在 `apps/bff/prisma/migrations/` 维护，与文档 Anchor 持续同步。
