"use client";
/**
 * @fileoverview Imperative query operations bound onto `queryAtom`.
 *
 * Each function in here becomes a method on the atom via the actions
 * bag in `query-atom.ts`. They form the non-React API surface
 * (`queryAtom.invalidate(...)`, `queryAtom.refetchQuery(...)`, etc.)
 * usable from event handlers, services, route loaders, anywhere.
 */
import { queryAtom } from "./query-atom";
import type {
  CacheStats,
  InvalidateOptions,
  Query,
  QueryKey,
  SeedEntry,
} from "./types";
import {
  abortInFlight,
  clearCache as engineClearCache,
  clearLatestQueryFn,
  debugQuery,
  garbageCollect as engineGarbageCollect,
  getCacheStats as engineGetCacheStats,
  limitCacheSize as engineLimitCacheSize,
  loadQuery,
  matchesQueryPrefix,
  parseQueryKey,
  refetch,
  refetchBackground,
  refetchMultiple,
  refetchMultipleBackground,
  runInBackground,
  setupAutoGC as engineSetupAutoGC,
} from "./utils";

/**
 * Invalidate queries whose key matches `queryKey`.
 *
 * Matching is segment-aware: invalidating `["users", 1]` matches
 * `["users", 1]` and `["users", 1, "profile"]` but NOT `["users", 10]`.
 */
export async function invalidate({
  queryKey,
  exact = false,
}: InvalidateOptions): Promise<void> {
  const prefix = parseQueryKey(queryKey);
  const data = queryAtom.get("queries");

  const matches = Object.entries(data).filter(([key]) =>
    exact ? key === prefix : matchesQueryPrefix(key, prefix),
  );

  debugQuery(queryKey, "invalidate", {
    exact,
    matches: matches.length,
  });

  // Force a fresh fetch for each matching query. `silent` keeps the UI
  // from flashing a loading state for background invalidations.
  await Promise.all(matches.map(([, q]) => loadQuery(q, "silent", true)));
}

export async function invalidateAll(): Promise<void> {
  const queries = Object.values(queryAtom.get("queries"));
  await Promise.all(queries.map(q => loadQuery(q, "silent", true)));
}

export function invalidateBackground(opts: InvalidateOptions): void {
  runInBackground(() => {
    invalidate(opts).catch(() => {});
  });
}

export function invalidateBackgroundAll(): void {
  runInBackground(() => {
    invalidateAll().catch(() => {});
  });
}

/**
 * Optimistically replace cached data. Pass an updater that receives the
 * current value (or `undefined` for queries that haven't loaded yet).
 *
 * Triggers a refresh event so subscribers re-render but does NOT trigger
 * a refetch. Use {@link refetchQuery} when you actually want fresh data.
 */
export function updateQueryData<T = any>(
  queryKey: QueryKey,
  updater: (oldData: T | undefined) => T,
): void {
  const key = parseQueryKey(queryKey);
  const query = queryAtom.get("queries")[key];
  if (!query) return;

  const newData = updater(query.data as T | undefined);
  queryAtom.change("queries", {
    ...queryAtom.get("queries"),
    [key]: { ...query, data: newData, lastModified: Date.now() },
  });
}

/**
 * Seed the cache with pre-fetched data. The standard integration point
 * for framework loaders (Next.js server components, Remix `loader`,
 * TanStack Start `loader`).
 *
 * When a `useQuery` consumer later mounts for the same key, it sees the
 * seeded data immediately and skips the on-mount refetch as long as the
 * data is still fresh per `staleTime` / `freshFor`.
 */
export function seedQuery<T = any>(entry: SeedEntry<T>): void {
  const hashKey = parseQueryKey(entry.queryKey);
  const now = Date.now();
  const queries = queryAtom.get("queries");
  const existing = queries[hashKey];

  // Freshness window: if `freshFor` is provided, treat the seeded value
  // as if it were fetched `now - freshFor + staleTime` ago — effectively,
  // count `freshFor` ms of remaining freshness from this moment.
  // Implementation: set `lastSuccessAt` to `now`, and assume the consuming
  // useQuery's `staleTime` will be at least `freshFor`. The simpler and
  // more common case is `freshFor === undefined`, which just sets
  // `lastSuccessAt = now` and lets the consumer's staleTime decide.
  const seeded: Query<T> = {
    ...(existing as Query<T> | undefined),
    data: entry.data,
    queryKey: entry.queryKey,
    hashKey,
    queryFn:
      existing?.queryFn ??
      (() => {
        throw new Error(
          `[atomic-query] Seeded query ${hashKey} has no queryFn; ` +
            `mount a useQuery({queryKey, queryFn}) consumer to refetch.`,
        );
      }),
    state: "success",
    isLoading: false,
    isFetching: false,
    isError: false,
    isRetrying: false,
    error: null,
    lastModified: now,
    lastAccessed: existing?.lastAccessed ?? now,
    lastSuccessAt: now,
    lastErrorAt: existing?.lastErrorAt,
    fetchCount: existing?.fetchCount ?? 0,
    retryCount: 0,
    maxRetries: existing?.maxRetries ?? 0,
    createdAt: existing?.createdAt ?? now,
    options: {
      ...(existing?.options ?? {}),
      ...(entry.freshFor !== undefined
        ? { staleTime: entry.freshFor }
        : {}),
    },
  };

  queryAtom.change("queries", { ...queries, [hashKey]: seeded });
  debugQuery(entry.queryKey, "seedQuery");
}

export function getData(queryKey: QueryKey): unknown {
  return queryAtom.get("queries")[parseQueryKey(queryKey)]?.data;
}

export function getQuery(queryKey: QueryKey): Query | undefined {
  return queryAtom.get("queries")[parseQueryKey(queryKey)];
}

/**
 * Remove a query from the cache and abort any in-flight fetch.
 */
export function destroyQuery(queryKey: QueryKey): void {
  const key = parseQueryKey(queryKey);
  const queries = queryAtom.get("queries");
  if (!queries[key]) return;
  abortInFlight(key);
  clearLatestQueryFn(key);
  const next = { ...queries };
  delete next[key];
  queryAtom.change("queries", next);
}

export function isStale(queryKey: QueryKey, staleTime?: number): boolean {
  const query = queryAtom.get("queries")[parseQueryKey(queryKey)];
  if (!query) return false;
  if (!query.lastSuccessAt) return true;
  return Date.now() - query.lastSuccessAt > (staleTime ?? 0);
}

export function refetchQuery(queryKey: QueryKey): Promise<void> {
  return refetch(queryKey);
}

export function refetchMultipleQueries(
  queryKeys: QueryKey[],
): Promise<void> {
  return refetchMultiple(queryKeys);
}

export function refetchQueryBackground(queryKey: QueryKey): void {
  refetchBackground(queryKey);
}

export function refetchMultipleQueriesBackground(
  queryKeys: QueryKey[],
): void {
  refetchMultipleBackground(queryKeys);
}

// ─── Cache-wide actions ─────────────────────────────────────────────────────
// These are thin wrappers around the engine functions. The wrappers exist
// so they can be mounted as actions on `queryAtom` with stable identities.
// (Previously these wrappers called themselves recursively — every call
// was a stack overflow.)

export function getCacheStats(): CacheStats {
  return engineGetCacheStats();
}

export function clearCache(): void {
  engineClearCache();
}

export function garbageCollect(gcTime: number = 5 * 60 * 1000): number {
  return engineGarbageCollect(gcTime);
}

export function limitCacheSize(maxQueries: number = 100): number {
  return engineLimitCacheSize(maxQueries);
}

export function setupAutoGC(
  interval: number = 60_000,
  gcTime: number = 5 * 60 * 1000,
  maxQueries: number = 100,
): () => void {
  return engineSetupAutoGC(interval, gcTime, maxQueries);
}
