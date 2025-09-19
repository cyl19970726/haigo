'use client';

import { WarehouseOrdersView } from '../../../features/orders/inbox';

export default function WarehouseOrdersPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <WarehouseOrdersView />
    </main>
  );
}
