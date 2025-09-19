'use client';

import { useMemo } from 'react';
import type { DirectoryFiltersState } from './useWarehouseDirectory';

interface WarehouseFiltersProps {
  filters: DirectoryFiltersState;
  onChange: (patch: Partial<DirectoryFiltersState>) => void;
  onReset: () => void;
}

const SORT_LABELS: Array<{ value: DirectoryFiltersState['sort']; label: string }> = [
  { value: 'score_desc', label: 'Highest score' },
  { value: 'fee_asc', label: 'Lowest fee' },
  { value: 'capacity_desc', label: 'Capacity (desc)' },
  { value: 'recent', label: 'Most recently updated' }
];

export function WarehouseFilters({ filters, onChange, onReset }: WarehouseFiltersProps) {
  const activeFilters = useMemo(() => {
    const values = [filters.q, filters.area, filters.minScore, filters.maxFeeBps].filter(Boolean).length;
    return values + (filters.available === false ? 1 : 0);
  }, [filters.area, filters.available, filters.maxFeeBps, filters.minScore, filters.q]);

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <form className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => event.preventDefault()}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Search</span>
          <input
            type="search"
            value={filters.q ?? ''}
            onChange={(event) => onChange({ q: event.target.value || undefined })}
            placeholder="Name or address"
            className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Minimum score</span>
          <input
            type="number"
            min={0}
            value={filters.minScore ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              onChange({ minScore: value === '' ? undefined : Number(value) });
            }}
            placeholder="60"
            className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Max fee (bps)</span>
          <input
            type="number"
            min={0}
            value={filters.maxFeeBps ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              onChange({ maxFeeBps: value === '' ? undefined : Number(value) });
            }}
            placeholder="50"
            className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Service area</span>
          <input
            type="text"
            value={filters.area ?? ''}
            onChange={(event) => onChange({ area: event.target.value || undefined })}
            placeholder="e.g. north-china"
            className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Sort by</span>
          <select
            value={filters.sort}
            onChange={(event) => onChange({ sort: event.target.value as DirectoryFiltersState['sort'] })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {SORT_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.available !== false}
            onChange={(event) => onChange({ available: event.target.checked ? true : false })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-slate-600">Show available only</span>
        </label>

        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:border-emerald-400 hover:text-emerald-600"
          >
            Reset filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
        </div>
      </form>
    </section>
  );
}
