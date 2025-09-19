'use client';

import { WarehouseOrdersCard } from '../../../features/orders/inbox';
import { SignOutButton } from '../../../features/auth/SignOutButton';

export default function WarehouseDashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Warehouse Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Review inbound and outbound tasks, latest merchant orders, and operational reminders in one place so the warehouse team can act quickly.
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <section className="grid gap-6 md:grid-cols-2">
        <WarehouseOrdersCard />
        <div className="flex h-full min-h-[240px] flex-col justify-center gap-3 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <h2 className="text-base font-medium text-foreground">Warehouse Operations Snapshot (coming soon)</h2>
          <p>We will surface metrics such as storage capacity, staking health, and exception alerts here.</p>
          <p>Please share via the feedback channel which data matters most to you on this dashboard.</p>
        </div>
      </section>
    </main>
  );
}
