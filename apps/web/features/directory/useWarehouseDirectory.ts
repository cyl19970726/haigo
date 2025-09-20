'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WarehouseSummary } from '@shared/dto/orders';
import {
  DEFAULT_DIRECTORY_PAGE_SIZE,
  type DirectoryFilters,
  type DirectoryResponse,
  type DirectorySort,
  fetchWarehouseDirectory
} from '../../lib/api/directory';

export interface DirectoryFiltersState {
  available?: boolean;
  minScore?: number;
  maxFeeBps?: number;
  area?: string;
  q?: string;
  sort: DirectorySort;
}

export interface UseWarehouseDirectoryResult extends DirectoryResponse {
  loading: boolean;
  error?: string;
  filters: DirectoryFiltersState;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  updateFilters: (patch: Partial<DirectoryFiltersState>) => void;
  resetFilters: () => void;
  refetch: () => void;
  hasActiveFilters: boolean;
}

const DEFAULT_FILTERS: DirectoryFiltersState = {
  available: true,
  sort: 'score_desc'
};

export function useWarehouseDirectory(initial?: Partial<DirectoryFiltersState>): UseWarehouseDirectoryResult {
  const [filters, setFilters] = useState<DirectoryFiltersState>(() => normalizeFilters({ ...DEFAULT_FILTERS, ...initial }));
  const [page, setPageInternal] = useState<number>(1);
  const [pageSize, setPageSizeInternal] = useState<number>(DEFAULT_DIRECTORY_PAGE_SIZE);
  const [items, setItems] = useState<WarehouseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cacheHit, setCacheHit] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  const hasActiveFilters = useMemo(() => {
    return (
      Boolean(filters.q) ||
      typeof filters.minScore === 'number' ||
      typeof filters.maxFeeBps === 'number' ||
      Boolean(filters.area) ||
      filters.available === false
    );
  }, [filters.area, filters.available, filters.maxFeeBps, filters.minScore, filters.q]);

  useEffect(() => {
    const controller = new AbortController();
    const requestFilters: DirectoryFilters = {
      available: filters.available,
      minScore: filters.minScore,
      maxFeeBps: filters.maxFeeBps,
      area: filters.area ? filters.area.toLowerCase() : undefined,
      q: filters.q?.trim() || undefined,
      sort: filters.sort,
      page,
      pageSize
    };

    setLoading(true);
    setError(undefined);

    fetchWarehouseDirectory(requestFilters, controller.signal)
      .then((response: DirectoryResponse) => {
        setItems(response.items);
        setTotal(response.total);
        setCacheHit(response.cacheHit);
        setGeneratedAt(response.generatedAt);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setItems([]);
        setTotal(0);
        setCacheHit(false);
        setGeneratedAt(undefined);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [filters.available, filters.area, filters.maxFeeBps, filters.minScore, filters.q, filters.sort, page, pageSize, revision]);

  const setPage = useCallback((nextPage: number) => {
    setPageInternal((prev) => {
      const resolved = Number.isFinite(nextPage) ? Math.max(Math.floor(nextPage), 1) : prev;
      return resolved;
    });
  }, []);

  const setPageSize = useCallback((nextSize: number) => {
    setPageSizeInternal((prev) => {
      const resolved = Number.isFinite(nextSize) ? Math.max(Math.floor(nextSize), 1) : prev;
      return resolved;
    });
    setPageInternal(1);
  }, []);

  const updateFilters = useCallback((patch: Partial<DirectoryFiltersState>) => {
    setFilters((prev) => normalizeFilters({ ...prev, ...patch }));
    setPageInternal(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(normalizeFilters(DEFAULT_FILTERS));
    setPageInternal(1);
  }, []);

  const refetch = useCallback(() => {
    setRevision((prev) => prev + 1);
  }, []);

  return {
    items,
    total,
    page,
    pageSize,
    cacheHit,
    generatedAt,
    loading,
    error,
    filters,
    setPage,
    setPageSize,
    updateFilters,
    resetFilters,
    refetch,
    hasActiveFilters
  };
}

function normalizeFilters(input: Partial<DirectoryFiltersState>): DirectoryFiltersState {
  const sanitizeNumber = (value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return value;
  };

  return {
    available: input.available,
    minScore: sanitizeNumber(input.minScore),
    maxFeeBps: sanitizeNumber(input.maxFeeBps),
    area: input.area?.trim() || undefined,
    q: input.q?.trim() || undefined,
    sort: input.sort ?? 'score_desc'
  };
}
