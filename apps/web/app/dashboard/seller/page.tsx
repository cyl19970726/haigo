'use client';

import { SignOutButton } from '../../../features/auth/SignOutButton';
import { ConfigurationNotice } from '../../../features/dashboard/common/ConfigurationNotice';
import { SellerQuickActionsCard } from '../../../features/dashboard/seller/SellerQuickActionsCard';
import { SellerRecentOrdersCard } from '../../../features/dashboard/seller/SellerRecentOrdersCard';
import { SellerWarehouseDirectoryCard } from '../../../features/dashboard/seller/SellerWarehouseDirectoryCard';

export default function SellerDashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">HaiGo Seller</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Seller workspace</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              快速跳转到常用任务：浏览社区仓库目录、发起新订单、跟踪链上订单状态。
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <ConfigurationNotice />

      <section className="grid gap-6 lg:grid-cols-2">
        <SellerQuickActionsCard />
        <SellerRecentOrdersCard />
      </section>

      <SellerWarehouseDirectoryCard />
    </main>
  );
}
