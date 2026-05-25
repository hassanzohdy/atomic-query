"use client";
/**
 * @fileoverview React hooks for the atomic-query cache.
 *
 * Every hook is built on `useSyncExternalStore` so reads stay tear-free
 * under React 18 concurrent rendering. Per-query subscriptions ensure
 * that updating one query doesn't wake every consumer of every other
 * query — the wakeup is O(1) per mutation regardless of cache size.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { queryAtom } from "./query-atom";
import type {
  AddQueryOptions,
  Query,
  QueryChangeType,
  QueryChangeTypeToValue,
  QueryKey,
} from "./types";
import {
  attachObserver,
  detachObserver,
  ensureAutoGCStarted,
  isQueryStale,
  loadQuery,
  parseQueryKey,
  refresh,
  setLatestQueryFn,
} from "./utils";

// ─── Per-hash placeholder cache ─────────────────────────────────────────────

/**
 * `useSyncExternalStore` requires `getSnapshot` to return a stable
 * identity when nothing has changed. The first render of a `useQuery`
 * happens BEFORE the create-query effect runs, so the snapshot returns
 * a placeholder. Cache the placeholder per hash so it's stable across
 * renders.
 *
 * The placeholder gets replaced with the real query the moment the
 * effect creates it; subsequent reads return the real entry.
 */
const placeholderCache = new Map<string, Query<any>>();

function getPlaceholder<T>(
  hashKey: string,
  queryKey: QueryKey,
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>,
  options: AddQueryOptions<T>,
): Query<T> {
  const cached = placeholderCache.get(hashKey);
  if (cached) return cached as Query<T>;
  const now = Date.now();
  const placeholder: Query<T> = {
    data: undefined,
    queryFn,
    queryKey,
    hashKey,
    state: "idle",
    isLoading: true,
    isFetching: false,
    isError: false,
    error: null,
    isRetrying: false,
    lastModified: now,
    lastAccessed: now,
    fetchCount: 0,
    retryCount: 0,
    maxRetries: options.retry ?? 0,
    createdAt: now,
    options: extractRuntimeOptions(options),
  };
  placeholderCache.set(hashKey, placeholder);
  return placeholder;
}

function extractRuntimeOptions<T>(
  options: AddQueryOptions<T>,
): Partial<AddQueryOptions<T>> {
  return {
    retry: options.retry,
    retryDelay: options.retryDelay,
    retryCondition: options.retryCondition,
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnReconnect: options.refetchOnReconnect,
  };
}

// ─── Per-query subscription ─────────────────────────────────────────────────

/**
 * Subscribe to ANY change in the cache slice keyed by `hashKey`,
 * including insertion (idle → loading → success) and removal.
 *
 * Returns the unsubscribe function expected by `useSyncExternalStore`.
 */
function subscribeToQuery(hashKey: string, onChange: () => void): () => void {
  const sub = queryAtom.onChange((newVal, oldVal) => {
    if (newVal.queries[hashKey] !== oldVal.queries[hashKey]) {
      onChange();
    }
  });
  return () => sub.unsubscribe();
}

// ─── useQuery ───────────────────────────────────────────────────────────────

/**
 * The flagship hook: read a query, subscribe to changes, and trigger
 * loading when the data is missing or stale.
 *
 * Behavior:
 * - `queryFn` is refreshed on every render so refetches always run the
 *   latest closure (no stale fetcher with old props/state).
 * - The query is created and the first fetch is dispatched in an effect,
 *   NOT during render — safe under Strict Mode and Suspense.
 * - Consumers register as observers; when the last one unmounts and
 *   `gcTime` ms pass, the engine GC's the entry.
 * - `refetchOnWindowFocus` and `refetchOnReconnect` honor `staleTime`.
 */
export function useQuery<T = any>(options: AddQueryOptions<T>): Query<T> {
  // Stable hash from the structural shape of the key. `useMemo` on the
  // raw reference would re-fire every render because callers usually
  // pass a new array literal.
  const hashKey = useMemo(
    () => parseQueryKey(options.queryKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parseQueryKey(options.queryKey)],
  );

  // Always-fresh fetcher. Updating a ref during render is allowed — it
  // doesn't mutate React-visible state.
  const queryFnRef = useRef(options.queryFn);
  queryFnRef.current = options.queryFn;
  setLatestQueryFn(hashKey, ((ctx: { signal: AbortSignal }) =>
    queryFnRef.current(ctx)) as any);

  // Keep the most recent callbacks fresh too.
  const onSuccessRef = useRef(options.onSuccess);
  const onErrorRef = useRef(options.onError);
  onSuccessRef.current = options.onSuccess;
  onErrorRef.current = options.onError;

  // Subscribe and snapshot.
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToQuery(hashKey, onChange),
    [hashKey],
  );
  const getSnapshot = useCallback((): Query<T> => {
    const entry = queryAtom.get("queries")[hashKey] as Query<T> | undefined;
    return entry ?? getPlaceholder(hashKey, options.queryKey, options.queryFn, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashKey]);

  const watch = options.watch ?? true;
  // When `watch` is false we still want a one-shot snapshot but no
  // subscription. Two getSnapshots, one no-op subscribe.
  const noopSubscribe = useCallback(() => () => {}, []);
  const query = useSyncExternalStore(
    watch ? subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );

  // Create-query + observer attachment effect.
  useEffect(() => {
    ensureAutoGCStarted();
    attachObserver(hashKey);

    const queries = queryAtom.get("queries");
    const existing = queries[hashKey];

    const now = Date.now();
    if (!existing) {
      // First consumer; install the real query.
      const created: Query<T> = {
        data: undefined,
        queryFn: ((ctx: { signal: AbortSignal }) =>
          queryFnRef.current(ctx)) as any,
        queryKey: options.queryKey,
        hashKey,
        state: "idle",
        isLoading: true,
        isFetching: false,
        isError: false,
        error: null,
        isRetrying: false,
        lastModified: now,
        lastAccessed: now,
        fetchCount: 0,
        retryCount: 0,
        maxRetries: options.retry ?? 0,
        createdAt: now,
        options: extractRuntimeOptions(options),
        onSuccess: onSuccessRef.current
          ? (data, q) => onSuccessRef.current?.(data as T, q as Query<T>)
          : undefined,
        onError: onErrorRef.current
          ? (err, q) => onErrorRef.current?.(err, q as Query<T>)
          : undefined,
      } as Query<T>;
      refresh(created);
    } else {
      // Update lastAccessed without creating a new top-level reference
      // for unrelated subscribers. We do still write through change()
      // because mutating in place would skip the subscription wave —
      // but this is rare (only when a NEW component mounts an existing
      // query) so the cost is bounded.
      if (existing.lastAccessed !== now) {
        queryAtom.change("queries", {
          ...queries,
          [hashKey]: { ...existing, lastAccessed: now },
        });
      }
    }

    // Kick off the initial fetch when appropriate.
    const refetchOnMount = options.refetchOnMount !== false;
    const queryNow = queryAtom.get("queries")[hashKey];
    if (queryNow) {
      const hasData = queryNow.data !== undefined;
      const stale = isQueryStale(queryNow, options.staleTime);
      if (queryNow.state === "idle" || (refetchOnMount && (!hasData || stale))) {
        loadQuery(queryNow, "normal").catch(() => {});
      }
    }

    return () => {
      // Detach the observer; do NOT abort the in-flight fetch. Aborting
      // here would break Strict Mode (unmount/remount cycles), route
      // bounces, and Suspense retries. Consumers that need explicit
      // cancellation should call `queryAtom.destroyQuery(key)`, which
      // both removes the entry and aborts. Untouched queries are
      // GC'd by the engine once `gcTime` ms have passed with no
      // observers.
      detachObserver(hashKey);
    };
    // We re-run when the hashKey changes; everything else read inside
    // the effect is captured via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashKey]);

  // Window focus refetch.
  useEffect(() => {
    if (!options.refetchOnWindowFocus) return;
    if (typeof window === "undefined") return;
    const handler = () => {
      const q = queryAtom.get("queries")[hashKey];
      if (q && isQueryStale(q, q.options?.staleTime)) {
        loadQuery(q, "silent", true).catch(() => {});
      }
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [hashKey, options.refetchOnWindowFocus]);

  // Network reconnect refetch.
  useEffect(() => {
    if (!options.refetchOnReconnect) return;
    if (typeof window === "undefined") return;
    const handler = () => {
      const q = queryAtom.get("queries")[hashKey];
      if (q) loadQuery(q, "silent", true).catch(() => {});
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [hashKey, options.refetchOnReconnect]);

  return query;
}

// ─── Granular field hooks ───────────────────────────────────────────────────

function useQueryField<F extends keyof Query>(
  queryKey: QueryKey,
  field: F,
): Query[F] | undefined {
  const hashKey = useMemo(
    () => parseQueryKey(queryKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parseQueryKey(queryKey)],
  );
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToQuery(hashKey, onChange),
    [hashKey],
  );
  const getSnapshot = useCallback(() => {
    const entry = queryAtom.get("queries")[hashKey];
    return entry ? entry[field] : undefined;
  }, [hashKey, field]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Read a single field of a query (loading, error, data, etc.) and
 * re-render only when THAT field changes.
 */
export function useQueryChange<T extends QueryChangeType>(
  queryKey: QueryKey,
  changeType: T,
): QueryChangeTypeToValue<T> | undefined {
  return useQueryField(queryKey, changeType) as QueryChangeTypeToValue<T> | undefined;
}

export function useLoadChange(queryKey: QueryKey): boolean {
  return (useQueryField(queryKey, "isLoading") as boolean | undefined) ?? false;
}

export function useErrorChange(queryKey: QueryKey): Error | null {
  return (useQueryField(queryKey, "error") as Error | null | undefined) ?? null;
}

export function useDataChange<T = any>(queryKey: QueryKey): T | null {
  const data = useQueryField(queryKey, "data") as T | undefined;
  return data === undefined ? null : data;
}
