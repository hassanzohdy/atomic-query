/**
 * @fileoverview Type definitions for the Query Atom system.
 *
 * `@mongez/atomic-query` is a CLIENT-SIDE cache for server state. Every
 * file in this package carries `"use client"` and the package is marked
 * `react-server: null` in its exports map, so it physically cannot be
 * loaded from a React Server Component. For initial server-rendered data,
 * use your framework's loader (Next.js server component, Remix `loader`,
 * TanStack Start `loader`) and pass the result to {@link HydrateQueries}
 * or {@link seedQuery} to seed the cache.
 */

import { type EventSubscription } from "@mongez/events";

/**
 * Any plain object that can appear inside a query key.
 */
export type GenericObject = Record<string, any>;

/**
 * A composite key that uniquely identifies a query in the cache.
 *
 * Keys can mix strings, numbers, plain objects, and nested arrays —
 * exactly the same shape TanStack Query accepts.
 *
 * @example
 *   ["users"]
 *   ["users", { role: "admin" }]
 *   ["users", 123, "profile"]
 */
export type QueryKey = (string | number | GenericObject | QueryKey[])[];

/**
 * Supported change types for the granular state-change hooks.
 */
export type QueryChangeType = "isLoading" | "isFetching" | "isError" | "data";

/**
 * Maps a {@link QueryChangeType} to the corresponding value type the hook
 * returns.
 */
export type QueryChangeTypeToValue<T extends QueryChangeType> =
  T extends "isLoading"
    ? boolean
    : T extends "isFetching"
      ? boolean
      : T extends "isError"
        ? Error | null
        : T extends "data"
          ? any
          : never;

/**
 * Coarse-grained lifecycle state for a query.
 *
 * - `idle`    — created, never fetched
 * - `loading` — first fetch in progress (no data yet)
 * - `error`   — last attempt failed
 * - `success` — at least one fetch has resolved
 */
export type QueryState = "idle" | "loading" | "error" | "success";

/**
 * The cached representation of a query.
 *
 * @template T Type of the data the query produces. `undefined` while the
 *             query has not produced a value yet.
 */
export type Query<T = any> = {
  /** Cached data; `undefined` until the first successful fetch. */
  data: T | undefined;
  /** Fallback fetcher stored on the query. The latest hook-provided
   * queryFn is preferred via an internal ref registry — this field is
   * the fallback used when the query is loaded outside of React (e.g.
   * via `refetchQuery` from a button handler that doesn't itself use
   * the hook). */
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
  /** Original query key supplied by the user. */
  queryKey: QueryKey;
  /** Stable hash derived from {@link queryKey}. */
  hashKey: string;
  /** Lifecycle state. */
  state: QueryState;
  /**
   * True while the FIRST fetch is in flight (no data yet). Becomes
   * false the first time data lands. Use this to render initial skeletons.
   */
  isLoading: boolean;
  /**
   * True while ANY fetch is in flight (initial or background). Use this
   * to render a "refreshing…" spinner separately from the initial loader.
   */
  isFetching: boolean;
  /** True if the last attempt failed. */
  isError: boolean;
  /** Error object from the last failed attempt, or `null`. */
  error: any;
  /** True while a retry is currently being awaited. */
  isRetrying: boolean;
  /** Timestamp of the last completed transition (success or error). */
  lastModified: number;
  /** Timestamp of the last time a consumer mounted this query. */
  lastAccessed: number;
  /** Number of completed fetches (any outcome). */
  fetchCount: number;
  /** Current retry attempt within the latest fetch cycle. */
  retryCount: number;
  /** Max retries configured for this query. */
  maxRetries: number;
  /** When this query was first inserted into the cache. */
  createdAt: number;
  /** Timestamp of the last successful fetch. */
  lastSuccessAt?: number;
  /** Timestamp of the last failed fetch. */
  lastErrorAt?: number;
  /** Subset of the original `AddQueryOptions` that influence runtime behavior. */
  options: Partial<AddQueryOptions<T>>;
};

/**
 * Shape of the atom's value: one big object whose `queries` map is keyed
 * by the stable hash of the query key.
 */
export type QueryPayload = {
  queries: Record<string, Query>;
};

/**
 * User-facing options for `useQuery` and `seedQuery`.
 */
export type AddQueryOptions<T = any> = {
  /** Identifies this query in the cache. */
  queryKey: QueryKey;
  /**
   * Fetcher invoked when the cache is stale, missing, or invalidated.
   * Receives an `AbortSignal` that is triggered when the consuming
   * component unmounts mid-fetch or when the query key changes.
   */
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
  /** Called after each successful fetch. */
  onSuccess?: (data: T, query: Query<T>) => void;
  /** Called after each failed fetch (post-retries). */
  onError?: (error: any, query: Query<T>) => void;
  /**
   * When `false`, the consuming component will not re-render on query
   * changes. The query still loads in the background.
   * @default true
   */
  watch?: boolean;
  /** Number of retries on failure. @default 0 */
  retry?: number;
  /** Delay (ms) between retries, fixed or computed. @default `1000 * attempt` */
  retryDelay?: number | ((attemptIndex: number) => number);
  /** Decide whether a given error should trigger a retry. */
  retryCondition?: (error: any, attemptIndex: number) => boolean;
  /** Data is considered fresh for this long (ms). @default 0 (always stale) */
  staleTime?: number;
  /** Unobserved queries are GC'd this many ms after the last observer detaches. @default 5 * 60_000 */
  gcTime?: number;
  /** Fetch on mount if data is missing or stale. @default true */
  refetchOnMount?: boolean;
  /** Fetch when the window regains focus and the data is stale. @default false */
  refetchOnWindowFocus?: boolean;
  /** Fetch when the browser regains network connectivity. @default false */
  refetchOnReconnect?: boolean;
};

/**
 * Options for {@link QueryActions.invalidate}.
 */
export type InvalidateOptions = {
  /** Key to invalidate. */
  queryKey: QueryKey;
  /**
   * When `true`, only the exact-match query is invalidated. When `false`
   * (the default), every query whose key starts with the given prefix
   * (at segment boundaries) is invalidated.
   *
   * Example: `invalidate({ queryKey: ["users", 1] })` matches
   * `["users", 1]` and `["users", 1, "profile"]` — NOT `["users", 10]`.
   */
  exact?: boolean;
};

/**
 * Seed payload passed to {@link QueryActions.seedQuery} and the
 * `<HydrateQueries>` component.
 */
export type SeedEntry<T = any> = {
  queryKey: QueryKey;
  data: T;
  /**
   * How long the seeded data should be treated as fresh before a `useQuery`
   * consumer triggers a refetch on mount. Defaults to the consuming query's
   * `staleTime` if unset, or `Infinity` to disable the on-mount refetch
   * entirely.
   */
  freshFor?: number;
};

/**
 * Stats returned by {@link QueryActions.getCacheStats}.
 */
export type CacheStats = {
  totalQueries: number;
  loadingQueries: number;
  errorQueries: number;
  successfulQueries: number;
  totalDataSize: number;
};

/**
 * The full action surface exposed on the `queryAtom`.
 */
export type QueryActions = {
  /**
   * Hook to read, subscribe to, and lazily start a query.
   */
  useQuery<T = any>(options: AddQueryOptions<T>): Query<T>;

  /**
   * Invalidates queries whose key matches `queryKey`. Matching is
   * segment-aware: `["users", 1]` matches `["users", 1]` and
   * `["users", 1, "profile"]` but NOT `["users", 10]`.
   */
  invalidate(options: InvalidateOptions): Promise<void>;

  /** Background variant of {@link invalidate}. */
  invalidateBackground(options: InvalidateOptions): void;

  /** Invalidates every query in the cache. */
  invalidateAll(): Promise<void>;

  /** Background variant of {@link invalidateAll}. */
  invalidateBackgroundAll(): void;

  /**
   * Refetch a single query and resolve with its result. Throws if the
   * query is not in the cache.
   */
  refetchQuery(queryKey: QueryKey): Promise<void>;

  /** Refetch every key in `queryKeys` in parallel. */
  refetchMultipleQueries(queryKeys: QueryKey[]): Promise<void>;

  /** Background variant of {@link refetchQuery}. */
  refetchQueryBackground(queryKey: QueryKey): void;

  /** Background variant of {@link refetchMultipleQueries}. */
  refetchMultipleQueriesBackground(queryKeys: QueryKey[]): void;

  /** True if the named query is older than `staleTime` ms. */
  isStale(queryKey: QueryKey, staleTime?: number): boolean;

  /**
   * Replace cached data without refetching. The updater receives the
   * current value (or `undefined` for queries that haven't loaded yet).
   */
  updateQueryData<T = any>(
    queryKey: QueryKey,
    updater: (oldData: T | undefined) => T,
  ): void;

  /**
   * Seed the cache with pre-fetched data. Typically called from a
   * framework's data loader (Next.js server component, Remix loader,
   * etc.) so the client doesn't refetch on mount.
   */
  seedQuery<T = any>(entry: SeedEntry<T>): void;

  /** Get the current data for `queryKey` or `undefined`. */
  getData(queryKey: QueryKey): any;

  /** Get the full {@link Query} object or `undefined`. */
  getQuery(queryKey: QueryKey): Query | undefined;

  /** Remove a query from the cache and abort any in-flight fetch. */
  destroyQuery(queryKey: QueryKey): void;

  /**
   * Subscribe to changes for a single query. Fires for the initial
   * `idle → loading → success` transition AND on destroy.
   */
  onQueryChange(
    queryKey: QueryKey,
    callback: (query: Query | undefined, oldQuery: Query | undefined) => void,
  ): EventSubscription;

  /** Granular state hook for a single field on a query. */
  useQueryChange<T extends QueryChangeType>(
    queryKey: QueryKey,
    changeType: T,
  ): QueryChangeTypeToValue<T> | undefined;

  /** Sugar for `useQueryChange(key, "isLoading")`. */
  useLoadChange(queryKey: QueryKey): boolean;

  /** Sugar for `useQueryChange(key, "isError")`. */
  useErrorChange(queryKey: QueryKey): Error | null;

  /** Sugar for `useQueryChange<T>(key, "data")`. */
  useDataChange<T = any>(queryKey: QueryKey): T | null;

  // Array manipulation helpers for list queries.
  push(queryKey: QueryKey, data: any): void;
  unshift(queryKey: QueryKey, data: any): void;
  pop(queryKey: QueryKey): void;
  shift(queryKey: QueryKey): void;
  replace(queryKey: QueryKey, index: number, data: any): void;
  remove(queryKey: QueryKey, item: any): void;
  removeByIndex(queryKey: QueryKey, index: number): void;
  clear(queryKey: QueryKey): void;
  sort(queryKey: QueryKey, compareFn: (a: any, b: any) => number): void;
  reverse(queryKey: QueryKey): void;

  /** Snapshot of cache health. */
  getCacheStats(): CacheStats;

  /** Wipe every query from the cache and abort their in-flight fetches. */
  clearCache(): void;

  /**
   * Remove queries that have been unobserved for more than `gcTime` ms.
   * Returns the number of queries removed.
   */
  garbageCollect(gcTime?: number): number;

  /** Cap cache size; removes the least-recently-accessed entries. */
  limitCacheSize(maxQueries?: number): number;

  /**
   * Start a recurring GC loop. Returns a stop function. Called
   * automatically on first `useQuery`; calling it explicitly is only
   * needed if you want a non-default interval.
   */
  setupAutoGC(
    interval?: number,
    gcTime?: number,
    maxQueries?: number,
  ): () => void;
};
