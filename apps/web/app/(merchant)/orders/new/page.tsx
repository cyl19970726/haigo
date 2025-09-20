'use client';

import { Suspense } from 'react';
import { CreateOrderView } from '../../../../features/orders/create/CreateOrderView';

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading order form…</div>}>
      <CreateOrderView />
    </Suspense>
  );
}
