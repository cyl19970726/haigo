'use client';

import Link from 'next/link';
import type { WarehouseSummary } from '@shared/dto/orders';
import { cn } from '../../lib/utils';

interface WarehouseCardProps {
  warehouse: WarehouseSummary;
}

const AVAILABILITY_TEXT: Record<WarehouseSummary['availability'], string> = {
  available: 'Available',
  limited: 'Limited',
  maintenance: 'Maintenance'
};

const AVAILABILITY_CLASS: Record<WarehouseSummary['availability'], string> = {
  available: 'bg-emerald-100 text-emerald-800',
  limited: 'bg-amber-100 text-amber-800',
  maintenance: 'bg-slate-200 text-slate-600'
};

const formatBps = (fee?: number) => {
  if (typeof fee !== 'number' || Number.isNaN(fee)) {
    return '—';
  }
  return `${(fee / 100).toFixed(fee % 100 === 0 ? 0 : 2)}%`;
};

export function WarehouseCard({ warehouse }: WarehouseCardProps) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{warehouse.name}</h3>
          <p className="text-xs font-mono text-slate-500">{warehouse.address}</p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
            AVAILABILITY_CLASS[warehouse.availability]
          )}
        >
          {AVAILABILITY_TEXT[warehouse.availability]}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-4 text-sm text-slate-600">
        <div>
          <dt className="font-medium text-slate-500">Staking score</dt>
          <dd className="text-base font-semibold text-slate-900">{warehouse.stakingScore.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Credit capacity (APT)</dt>
          <dd className="text-base font-semibold text-slate-900">{warehouse.creditCapacity.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Storage fee</dt>
          <dd className="text-base font-semibold text-slate-900">{formatBps(warehouse.feePerUnit)}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Last audit</dt>
          <dd>{warehouse.lastAuditAt ? new Date(warehouse.lastAuditAt).toLocaleDateString() : '—'}</dd>
        </div>
      </dl>

      {warehouse.mediaSamples?.length ? (
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          {warehouse.mediaSamples.map((sample) => (
            <span key={sample} className="rounded-full bg-slate-100 px-2 py-1">
              {sample}
            </span>
          ))}
        </div>
      ) : null}

      {warehouse.serviceAreas?.length ? (
        <div className="mt-4 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Service areas:</span>{' '}
          {warehouse.serviceAreas.join(', ')}
        </div>
      ) : null}

      <Link
        href={`/orders/new?warehouse=${encodeURIComponent(warehouse.address)}`}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        Select warehouse
      </Link>
    </article>
  );
}
