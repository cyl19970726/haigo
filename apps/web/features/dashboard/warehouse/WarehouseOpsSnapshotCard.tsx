'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';

export const WarehouseOpsSnapshotCard = () => {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>运营快照（预览）</CardTitle>
        <CardDescription>未来将在此展示库存、告警与服务指标，帮助快速评估运营状况。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>• 指标面板筹备中，请确保订单打点与质押信息准确，以便后续自动聚合。</p>
          <p>• 若需提前了解指标规划，可联系运营支持团队获取指南。</p>
          <p>• 完成仓库资料与质押配置后，将解锁更多可观测性模块。</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default WarehouseOpsSnapshotCard;
