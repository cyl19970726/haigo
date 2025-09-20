# Warehouse Dashboard 快速质押入口修复方案

## 1. 背景与现状
- 截图（`截屏2025-09-20 03.43.27.png`）显示 `/dashboard/warehouse` 侧边栏存在四个按钮。目前左侧两个按钮（“快速质押”“调整费率”）点击后出现 `Not Found`，右侧两个按钮触发编译错误。
- 近期集成计划（见 `integration-plan.md`）新增了对话框型 Quick Actions，但未清理旧有按钮，导致重复入口与路由缺失。
- 目标是保留左侧两个按钮且可正常工作，右侧按钮移除或替换为正确入口，避免编译错误。

## 2. 目标
1. **整合入口**：只保留左侧“快速质押（Stake）”“调整费率（Adjust Fee）”按钮，并确保点击后弹出 Shadcn `Dialog` 内嵌 `Card` 的 Action 卡片。
2. **修复路由/组件缺失**：解决 `Not Found`，确保按钮指向存在的 React 组件，避免 run-time 错误与编译失败。
3. **复用统一数据流**：前端调用 `useStakingIntent`/`useStakingActions`，成功后刷新仓库质押概览。
4. **消除重复 UI**：移除右侧导致编译错误的旧按钮或无效组件引用，页面零警告通过 `pnpm --filter @haigo/web lint`、`pnpm --filter @haigo/web test`。
5. **与架构文档同步**：更新相关 `docs/architecture` 章节，确保文档与实现一致。

## 3. 必读资料
- `integration-plan.md` 与 `intergation-plan-001.md`（现有集成策略、后续里程碑）。
- `docs/architecture/5-前端体验.md`：界面与交互规范。
- `docs/architecture/4-链下服务与数据流.md`：BFF 数据流、缓存策略。
- `docs/architecture/3-链上合约设计.md`：staking 合约函数、错误码。
- `apps/web/features/staking/useStakingActions.ts`、`apps/web/lib/api/staking.ts` 当前实现。

## 4. 数据流与结构调整

### 4.1 前端数据结构与核心代码
- 依赖安装（Shadcn MCP 建议命令）：
  ```bash
  pnpm dlx shadcn@latest add @shadcn/card @shadcn/button @shadcn/dialog @shadcn/form @shadcn/input @shadcn/label @shadcn/separator
  ```
- `apps/web/features/dashboard/warehouse/WarehouseDashboardPage.tsx`
  ```tsx
  const WarehouseDashboardPage = () => {
    const [activeAction, setActiveAction] = useState<'stake' | 'fee' | null>(null);
    const warehouseAddress = useWarehouseContext();
    const { data: intent, isFetching, refetch } = useStakingIntent(warehouseAddress);

    const handleSuccess = useCallback(() => {
      refetch();
      setActiveAction(null);
    }, [refetch]);

    return (
      <>
        <WarehouseQuickActionsCard
          intent={intent?.data}
          disabled={isFetching}
          onAction={setActiveAction}
        />
        <WarehouseStakingActionDialog
          mode={activeAction ?? 'stake'}
          isOpen={activeAction !== null}
          intent={intent?.data}
          onClose={() => setActiveAction(null)}
          onSuccess={handleSuccess}
        />
      </>
    );
  };
  ```
- `apps/web/features/dashboard/warehouse/WarehouseQuickActionsCard.tsx`
  ```tsx
  import { Card, CardContent, CardHeader, CardTitle } from '@haigo/ui/card';
  import { Button } from '@haigo/ui/button';

  export const WarehouseQuickActionsCard = ({ intent, disabled, onAction }: Props) => (
    <Card>
      <CardHeader>
        <CardTitle>快速操作</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button onClick={() => onAction('stake')} disabled={disabled}>快速质押</Button>
        <Button onClick={() => onAction('fee')} disabled={disabled}>调整费率</Button>
      </CardContent>
    </Card>
  );
  ```
- 右侧旧按钮删除：将对应 JSX 块移除；如需保留提示，改为 `Muted` 状态。
- `apps/web/features/staking/components/WarehouseStakingActionDialog.tsx`
  ```tsx
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@haigo/ui/dialog';
  import { Card, CardContent, CardFooter } from '@haigo/ui/card';
  import { Button } from '@haigo/ui/button';
  import { Input } from '@haigo/ui/input';

  export const WarehouseStakingActionDialog = ({ isOpen, mode, intent, onClose, onSuccess }: Props) => {
    const { stake, setStorageFee, error, submitting } = useStakingActions();
    const [amount, setAmount] = useState('');
    const [fee, setFee] = useState(intent?.feePerUnit?.toString() ?? '0');

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (mode === 'stake') {
        await stake(parseAptToOcta(amount));
      } else {
        await setStorageFee(Number(fee));
      }
      onSuccess();
    };

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'stake' ? '快速质押' : '调整费率'}</DialogTitle>
          </DialogHeader>
          <Card>
            <form onSubmit={handleSubmit} className="flex flex-col">
              <CardContent className="space-y-4">
                {mode === 'stake' ? (
                  <FormField label="质押金额 (APT)" htmlFor="stakeAmount">
                    <Input
                      id="stakeAmount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="例如：1.5"
                      required
                    />
                  </FormField>
                ) : (
                  <FormField label="仓储费率 (bps)" htmlFor="fee" helperText="0 - 10000">
                    <Input
                      id="fee"
                      type="number"
                      value={fee}
                      onChange={(event) => setFee(event.target.value)}
                      min={0}
                      max={10000}
                      required
                    />
                  </FormField>
                )}
                {error && <Alert variant="destructive">{mapStakingError(error)}</Alert>}
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                  取消
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? '提交中…' : '确认提交'}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </DialogContent>
      </Dialog>
    );
  };
  ```

### 4.2 API 与请求/响应
- BFF `GET /api/staking/:warehouseAddress`
  - Request: `params: warehouseAddress; query: { source?: 'onchain' | 'cache' }`
  - Response:
    ```json
    {
      "data": {
        "warehouseAddress": "0x...",
        "stakedAmount": "123000000", // octas
        "minRequired": "100000000",
        "feePerUnit": 35,
        "updatedAt": "2025-09-20T03:30:00Z"
      },
      "meta": {
        "source": "onchain",
        "txnVersion": "123456789"
      }
    }
    ```
  - 若 `source=onchain`，BFF 调用链上 view 失败时降级为缓存并在 `meta.source` 标注。

### 4.3 后端结构体
- `packages/shared/src/dto/staking.ts`
  - `StakingIntentDto` 增加 `updatedAt`, `txnVersion`，确保前端可以提示数据延迟。
- `apps/bff/src/modules/staking/staking.service.ts`
  - `getIntent(address, { source })`：当 `source === 'onchain'` 时绕过缓存、强制调用链上 view。
  - 记录日志/metrics 以观测失败原因。
- `apps/bff/src/modules/staking/staking.controller.ts`
  - 解析 query 参数，返回统一 DTO。
- `apps/bff/prisma/schema.prisma`
  - 校验 `staking_positions`, `storage_fees_cache` 是否具备 `updated_at` 字段；若无则新增迁移。

### 4.4 链上合约结构体
- Move `staking.move`
  - 复用已有 `StakingBook`、`StakeChanged`、`StorageFeeUpdated`。
  - 如需 `min_required` 视图，新增 `public fun min_required(warehouse: address): u64`。
  - 错误码保持 `E_INVALID_AMOUNT`、`E_INVALID_FEE`，前端通过映射展示。
- 如暂不修改合约，本阶段记录 TODO，在 `integration-plan-001.md` 排期。

### 4.5 数据流示意
1. 用户点击按钮 → React state 打开 Dialog → 校验表单。
2. 调用 `useStakingActions().stake` 或 `setStorageFee` → 钱包签名 → 交易哈希返回。
3. 提示成功 → 触发 `useStakingIntent().refetch()`。
4. `fetchStakingIntent` 请求 `/api/staking/:warehouse` → BFF -> 链上 view / 缓存。
5. 更新 UI → Dialog 关闭。

## 5. 按钮跳转与行为规范
- 左侧按钮：
  - “快速质押”：`onClick={() => setActiveAction('stake')}` → `WarehouseStakingActionDialog` 模式 `stake`。
  - “调整费率”：`onClick={() => setActiveAction('fee')}` → 模式 `fee`。
- 右侧按钮处理：
  - 移除或替换为占位（例如“即将上线”），确保不引用不存在组件。
  - 若必须保留占位按钮，使用 `<Button disabled>` 并附上 tooltip，禁止导航。

## 6. 需要更新的架构文档
- `docs/architecture/5-前端体验.md`：新增 Warehouse Quick Actions 子节，描述对话框流程、错误提示、无钱包状态。
- `docs/architecture/4-链下服务与数据流.md`：更新 staking API 时序图，加入强制刷新参数。
- `docs/architecture/3-链上合约设计.md`：若新增视图/事件或错误码映射，补充说明。
- `docs/architecture/10-场景化端到端数据流.md`：追加“仓库快速质押”时序图。
- `docs/architecture/6-部署与环境.md`：若新增环境变量（例如 `NEXT_PUBLIC_STAKING_MODULE_ADDRESS`、`BFF_STAKING_FORCE_SOURCE`）。

## 7. 实施步骤 Checklist
1. 阅读必读文档 & 现有实现，确认数据流现状。
2. 清理 `/dashboard/warehouse` 右侧无效按钮，保留左侧两个入口。
3. 按上述代码结构实现/接入 `WarehouseStakingActionDialog`，确保按钮打开含 Shadcn `Card` 的 Dialog。
4. 调整 `WarehouseQuickActionsCard`，通过 props 向 Dialog 传递 `intent`、`onAction`。
5. 更新 `useStakingActions` / `fetchStakingIntent`，实现成功回调与错误提示。
6. 补充/修复单元测试与 UI 测试（Jest + Playwright/Cypress）；为 Dialog 行为新增测试用例。
7. 运行 `pnpm --filter @haigo/web lint`、`pnpm --filter @haigo/web test`、必要的 BFF 测试。
8. 验证钱包连接/断开、链上失败/缓存回退、重复点击、输入边界等场景。
9. 更新 `docs/architecture` 指定章节，提交 PR 与代码同时评审。
10. 记录变更（含截图）于发布说明与 `integration-plan.md`。

---

如需额外信息（例如合约改动计划、UI 设计稿），请在执行前确认产品与合约团队最新结论。
