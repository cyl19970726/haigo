'use client';

import { useMemo } from 'react';
import { WarehouseCard } from '../../../features/directory/WarehouseCard';
import { WarehouseFilters } from '../../../features/directory/WarehouseFilters';
import { useWarehouseDirectory } from '../../../features/directory/useWarehouseDirectory';

export default function WarehouseDirectoryPage() {
  const directory = useWarehouseDirectory();

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(directory.total / directory.pageSize));
  }, [directory.pageSize, directory.total]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Directory</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Find a HaiGo warehouse partner</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Browse registered community warehouses, compare staking scores, and choose the facility that matches your fulfilment needs before creating an order.
        </p>
      </header>

      <WarehouseFilters filters={directory.filters} onChange={directory.updateFilters} onReset={directory.resetFilters} />

      {directory.loading ? (
        <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-10 text-center text-slate-500">
          Loading warehouse availability…
        </div>
      ) : directory.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {directory.error}
          <button
            type="button"
            onClick={directory.refetch}
            className="ml-4 rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      ) : directory.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-slate-500">
          No warehouses match your filters yet. Try relaxing the filters or check back soon.
        </div>
      ) : (
        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {directory.items.map((warehouse) => (
            <WarehouseCard key={warehouse.id} warehouse={warehouse} />
          ))}
        </section>
      )}

      <footer className="mt-8 flex flex-col gap-3 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="font-medium text-slate-700">{directory.total.toLocaleString()} warehouses</span>
          {directory.generatedAt ? ` · Updated ${new Date(directory.generatedAt).toLocaleTimeString()}` : ''}
          {directory.cacheHit ? ' · Cached' : ''}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => directory.setPage(directory.page - 1)}
            disabled={directory.page <= 1}
            className="rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-2 text-xs uppercase tracking-wide text-slate-400">
            Page {directory.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => directory.setPage(directory.page + 1)}
            disabled={directory.page >= totalPages}
            className="rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </footer>
    </main>
  );
}
