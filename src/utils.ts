"use client";
/**
 * @fileoverview Internal engine for the atomic-query cache.
 *
 * Pieces of state that live here rather than on the atom value because
 * they're either non-serializable (AbortControllers, promises, refs) or
 * because mutating them must not trigger subscriber re-renders.
 */
import { queryAtom } from "./query-atom";
import type { Query, QueryKey } from "./types";

// ─── Stable hashing ─────────────────────────────────────────────────────────

/**
 * Produce a stable string hash from a {@link QueryKey}.
 *
 * Uses `JSON.stringify` with a sorted-keys replacer so that
 *   - object key order doesn't affect the hash, and
 *   - characters inside string values can't collide with the separator
 *     (the old pipe-joined implementation hashed `["users", "1|2"]` and
 *     `["users", 1, 2]` to the same string).
 */
export const serializeQueryKey = (key: unknown): string => {
  return JSON.stringify(key, (_, value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      // Sort object keys to canonicalize order.
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
};

/**
 * Compute the cache hash for a query key.
 *
 * The returned string is what `queryAtom.value.queries` is keyed by. Two
 * query keys that differ only in object-key insertion order produce the
 * same hash.
 */
export const parseQueryKey = (queryKey: QueryKey): string => {
  return serializeQueryKey(queryKey);
};

/**
 * Segment-aware prefix match for partial invalidation. Two hashes match
 * when the prefix is exact OR the prefix is followed by a JSON-array
 * boundary (`,` after a complete element).
 *
 * Concretely: `serialized(["users", 1])` is `'["users",1]'`. A child
 * `serialized(["users", 1, "profile"])` is `'["users",1,"profile"]'`,
 * which we want to match. The sibling `serialized(["users", 10])` is
 * `'["users",10]'`, which we do NOT want to match.
 *
 * The strategy: drop the trailing `]` off the prefix hash, treat the
 * result as the "open" form, and require the candidate hash to start
 * with that open form. `'["users",1'` is the open form of `["users", 1]`;
 * `'["users",10]'` does NOT start with `'["users",1,'` or equal
 * `'["users",1]'`, so it correctly fails to match.
 */
export const matchesQueryPrefix = (
  candidate: string,
  prefix: string,
): boolean => {
  if (candidate === prefix) return true;
  // `prefix` is a fully-closed JSON array like `["users",1]`.
  // The child must extend it past the closing bracket, i.e. the prefix
  // (minus its closing bracket) followed by a `,`.
  if (prefix.endsWith("]")) {
    const open = prefix.slice(0, -1) + ",";
    return candidate.startsWith(open);
  }
  return false;
};

// ─── Per-key registries (not stored on the atom value) ──────────────────────

/**
 * Latest user-provided `queryFn` per hash. Hooks refresh this each render
 * so background refetches don't run a stale closure. Plain object atoms
 * could also work, but a Map keeps the hash space tidy and side-effect-free.
 */
const queryFnRegistry = new Map<
  string,
  (ctx: { signal: AbortSignal }) => Promise<any>
>();

export function setLatestQueryFn(
  hashKey: string,
  fn: (ctx: { signal: AbortSignal }) => Promise<any>,
): void {
  queryFnRegistry.set(hashKey, fn);
}

export function getLatestQueryFn(
  hashKey: string,
): ((ctx: { signal: AbortSignal }) => Promise<any>) | undefined {
  return queryFnRegistry.get(hashKey);
}

/** Drop the queryFn for a hash. Called on destroy. */
export function clearLatestQueryFn(hashKey: string): void {
  queryFnRegistry.delete(hashKey);
}

/**
 * AbortControllers for in-flight fetches, keyed by hash. A new fetch
 * always replaces the controller; the previous fetch is aborted.
 */
const abortControllers = new Map<string, AbortController>();

/** Abort and forget the controller for `hashKey`. No-op when absent. */
export function abortInFlight(hashKey: string): void {
  const ctrl = abortControllers.get(hashKey);
  if (ctrl) {
    ctrl.abort();
    abortControllers.delete(hashKey);
  }
}

/**
 * Promise-dedup map. Concurrent calls to `loadQuery` for the same hash
 * share a single underlying promise instead of issuing duplicate fetches.
 * The entry is cleared when the promise settles.
 */
const inFlight = new Map<string, Promise<void>>();

/**
 * Reference counting: number of mounted consumers per hash. Used to
 * defer GC of recently-detached queries.
 */
const observerCount = new Map<string, number>();

export function attachObserver(hashKey: string): void {
  observerCount.set(hashKey, (observerCount.get(hashKey) ?? 0) + 1);
}

export function detachObserver(hashKey: string): number {
  const next = (observerCount.get(hashKey) ?? 1) - 1;
  if (next <= 0) {
    observerCount.delete(hashKey);
    return 0;
  }
  observerCount.set(hashKey, next);
  return next;
}

export function getObserverCount(hashKey: string): number {
  return observerCount.get(hashKey) ?? 0;
}

// ─── Atom-value mutation helpers ────────────────────────────────────────────

/**
 * Replace one query in the cache. Always writes a new top-level
 * `queries` object so atom subscribers see a reference change.
 */
export const refresh = (query: Query): void => {
  const data = queryAtom.get("queries");
  queryAtom.change("queries", {
    ...data,
    [query.hashKey]: query,
  });
};

/** Shallow clone a query. */
export const cloneQuery = <T>(query: Query<T>): Query<T> => ({ ...query });

/**
 * True if the query's data is older than `staleTime` ms. Queries without
 * a successful fetch are considered stale.
 */
export const isQueryStale = (query: Query, staleTime?: number): boolean => {
  if (!query.lastSuccessAt) return true;
  if (!staleTime) return true;
  return Date.now() - query.lastSuccessAt > staleTime;
};

/**
 * Fire `fn` in a way that doesn't block paint. Uses
 * `requestIdleCallback` when available, falls back to a microtask.
 */
export const runInBackground = (fn: () => void | Promise<void>): void => {
  if (
    typeof window !== "undefined" &&
    typeof (window as any).requestIdleCallback === "function"
  ) {
    (window as any).requestIdleCallback(() => {
      fn();
    });
  } else {
    Promise.resolve().then(() => {
      fn();
    });
  }
};

/** Dev-only logger. Stripped in production builds via NODE_ENV. */
export const debugQuery = (
  queryKey: QueryKey,
  action: string,
  data?: any,
): void => {
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "development"
  ) {
    // eslint-disable-next-line no-console
    console.log(`[atomic-query] ${action}:`, {
      queryKey: JSON.stringify(queryKey),
      data,
    });
  }
};

// ─── The fetch engine ───────────────────────────────────────────────────────

type LoadMode = "normal" | "silent";

/**
 * Execute a query's fetcher and update the cache with the result.
 *
 * Behavior:
 * - Concurrent calls for the same hash share one promise (dedup).
 * - The previous in-flight fetch is aborted when a new one starts (for
 *   the same hash). Stale results that resolve after a newer fetch
 *   completes are dropped.
 * - In "normal" mode, both `isLoading` (first time) and `isFetching`
 *   are flipped on. In "silent" mode, only `isFetching` is set — useful
 *   for background invalidations that shouldn't trigger UI loaders.
 * - Errors trigger retries per the query's `retry` / `retryDelay` /
 *   `retryCondition` options.
 */
export const loadQuery = async (
  query: Query,
  loadMode: LoadMode = "normal",
  force: boolean = false,
): Promise<void> => {
  const hashKey = query.hashKey;

  // Dedup: concurrent calls join the existing promise.
  const existing = inFlight.get(hashKey);
  if (existing && !force) return existing;

  // Staleness short-circuit for silent loads. A silent (background) load
  // for fresh data is a no-op.
  if (
    !force &&
    loadMode === "silent" &&
    query.data !== undefined &&
    !isQueryStale(query, query.options?.staleTime)
  ) {
    debugQuery(query.queryKey, "loadQuery skipped (fresh)");
    return;
  }

  // Abort any previous fetch for this hash before starting a new one.
  abortInFlight(hashKey);
  const controller = new AbortController();
  abortControllers.set(hashKey, controller);

  const promise = (async () => {
    let current = cloneQuery(query);
    current.state = "loading";
    current.isFetching = true;
    current.isError = false;
    current.error = null;
    current.isRetrying = false;
    current.retryCount = 0;
    if (loadMode === "normal" && current.data === undefined) {
      current.isLoading = true;
    }
    refresh(current);
    debugQuery(query.queryKey, "loadQuery start", { loadMode });

    const maxRetries = current.options?.retry ?? 0;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const fn = getLatestQueryFn(hashKey) ?? current.queryFn;
        const result = await fn({ signal: controller.signal });

        // If we were aborted while awaiting, drop the result silently.
        if (controller.signal.aborted) {
          debugQuery(query.queryKey, "loadQuery aborted");
          return;
        }

        current = cloneQuery(current);
        current.data = result;
        current.state = "success";
        current.isLoading = false;
        current.isFetching = false;
        current.isError = false;
        current.error = null;
        current.isRetrying = false;
        current.fetchCount += 1;
        current.lastModified = Date.now();
        current.lastSuccessAt = current.lastModified;
        current.lastErrorAt = undefined;

        refresh(current);
        debugQuery(query.queryKey, "loadQuery success");

        // Late-stage callback resolution — read from the current query
        // in the atom so callbacks see post-update fields.
        const latest = queryAtom.get("queries")[hashKey];
        if (latest && query.onSuccess) {
          try {
            query.onSuccess(result, latest);
          } catch (err) {
            debugQuery(query.queryKey, "onSuccess threw", err);
          }
        }
        return;
      } catch (err) {
        if (controller.signal.aborted) {
          debugQuery(query.queryKey, "loadQuery aborted mid-error");
          return;
        }

        attempt += 1;
        const shouldRetry =
          attempt <= maxRetries &&
          (!current.options?.retryCondition ||
            current.options.retryCondition(err, attempt - 1));

        if (shouldRetry) {
          current = cloneQuery(current);
          current.isRetrying = true;
          current.retryCount = attempt;
          current.lastErrorAt = Date.now();
          refresh(current);

          const delay =
            typeof current.options?.retryDelay === "function"
              ? current.options.retryDelay(attempt - 1)
              : (current.options?.retryDelay ?? 1000 * attempt);
          await new Promise<void>(resolve => setTimeout(resolve, delay));
          if (controller.signal.aborted) return;
          continue;
        }

        // Out of retries: commit the error state.
        current = cloneQuery(current);
        current.state = "error";
        current.isLoading = false;
        current.isFetching = false;
        current.isError = true;
        current.error = err;
        current.isRetrying = false;
        current.lastModified = Date.now();
        current.lastErrorAt = current.lastModified;
        refresh(current);
        debugQuery(query.queryKey, "loadQuery failed", err);

        const latest = queryAtom.get("queries")[hashKey];
        if (latest && query.onError) {
          try {
            query.onError(err, latest);
          } catch (cbErr) {
            debugQuery(query.queryKey, "onError threw", cbErr);
          }
        }
        return;
      }
    }
  })().finally(() => {
    inFlight.delete(hashKey);
    if (abortControllers.get(hashKey) === controller) {
      abortControllers.delete(hashKey);
    }
  });

  inFlight.set(hashKey, promise);
  return promise;
};

/** Refetch a query by key. Throws if the query is not in the cache. */
export const refetch = async (queryKey: QueryKey): Promise<void> => {
  const query = queryAtom.get("queries")[parseQueryKey(queryKey)];
  if (!query) {
    throw new Error(
      `[atomic-query] Cannot refetch unknown query: ${JSON.stringify(queryKey)}`,
    );
  }
  return loadQuery(query, "normal", true);
};

export const refetchMultiple = async (
  queryKeys: QueryKey[],
): Promise<void> => {
  const queries = queryKeys
    .map(k => queryAtom.get("queries")[parseQueryKey(k)])
    .filter(Boolean) as Query[];
  await Promise.all(queries.map(q => loadQuery(q, "normal", true)));
};

export const refetchBackground = (queryKey: QueryKey): void => {
  runInBackground(() => {
    // Fire-and-forget but swallow rejections so a failing background
    // refetch doesn't produce an unhandled-promise-rejection warning.
    refetch(queryKey).catch(() => {});
  });
};

export const refetchMultipleBackground = (queryKeys: QueryKey[]): void => {
  runInBackground(() => {
    refetchMultiple(queryKeys).catch(() => {});
  });
};

// ─── Garbage collection ─────────────────────────────────────────────────────

/**
 * Remove queries that have no observers AND haven't been accessed within
 * `gcTime` ms. Returns the number of queries removed.
 */
export const garbageCollect = (gcTime: number = 5 * 60 * 1000): number => {
  const data = queryAtom.get("queries");
  const now = Date.now();
  const toRemove: string[] = [];

  for (const [hashKey, query] of Object.entries(data)) {
    if (getObserverCount(hashKey) > 0) continue;
    if (now - query.lastAccessed > gcTime) {
      toRemove.push(hashKey);
    }
  }

  if (toRemove.length > 0) {
    const next = { ...data };
    for (const k of toRemove) {
      delete next[k];
      abortInFlight(k);
      clearLatestQueryFn(k);
    }
    queryAtom.change("queries", next);
  }

  return toRemove.length;
};

/**
 * Cap the cache at `maxQueries` entries by evicting the
 * least-recently-accessed entries that have no observers.
 */
export const limitCacheSize = (maxQueries: number = 100): number => {
  const data = queryAtom.get("queries");
  const entries = Object.entries(data);
  if (entries.length <= maxQueries) return 0;

  // Only consider unobserved entries for eviction.
  const evictable = entries
    .filter(([k]) => getObserverCount(k) === 0)
    .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

  const removeCount = Math.min(
    entries.length - maxQueries,
    evictable.length,
  );
  if (removeCount === 0) return 0;

  const next = { ...data };
  for (let i = 0; i < removeCount; i++) {
    const [k] = evictable[i];
    delete next[k];
    abortInFlight(k);
    clearLatestQueryFn(k);
  }
  queryAtom.change("queries", next);
  return removeCount;
};

export const clearCache = (): void => {
  const data = queryAtom.get("queries");
  for (const k of Object.keys(data)) {
    abortInFlight(k);
    clearLatestQueryFn(k);
  }
  observerCount.clear();
  queryAtom.change("queries", {});
};

export const getCacheStats = () => {
  const data = queryAtom.get("queries");
  const entries = Object.values(data);
  const stats = {
    totalQueries: entries.length,
    loadingQueries: 0,
    errorQueries: 0,
    successfulQueries: 0,
    totalDataSize: 0,
  };
  for (const q of entries) {
    if (q.isLoading) stats.loadingQueries++;
    else if (q.isError) stats.errorQueries++;
    else if (q.state === "success") stats.successfulQueries++;
    if (q.data !== undefined) {
      try {
        stats.totalDataSize += JSON.stringify(q.data).length;
      } catch {
        // Unserializable data (cycles, etc.) — skip the size estimate.
      }
    }
  }
  return stats;
};

let autoGCTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Start a recurring GC loop. Idempotent — subsequent calls clear the
 * previous timer first.
 */
export const setupAutoGC = (
  interval: number = 60_000,
  gcTime: number = 5 * 60 * 1000,
  maxQueries: number = 100,
): (() => void) => {
  if (autoGCTimer) clearInterval(autoGCTimer);
  autoGCTimer = setInterval(() => {
    garbageCollect(gcTime);
    limitCacheSize(maxQueries);
  }, interval);
  return () => {
    if (autoGCTimer) {
      clearInterval(autoGCTimer);
      autoGCTimer = undefined;
    }
  };
};

/**
 * Auto-start the GC loop the first time anything in the cache moves.
 * Internal — called by `useQuery`. No-op on the server.
 */
export const ensureAutoGCStarted = (): void => {
  if (autoGCTimer) return;
  if (typeof window === "undefined") return;
  setupAutoGC();
};

// ─── Test-only reset ────────────────────────────────────────────────────────

/**
 * Reset every piece of in-memory state owned by this module. Used by the
 * test suite between cases. Not exported from the package index.
 */
export const __resetAtomicQueryForTests = (): void => {
  for (const ctrl of abortControllers.values()) ctrl.abort();
  abortControllers.clear();
  inFlight.clear();
  queryFnRegistry.clear();
  observerCount.clear();
  if (autoGCTimer) {
    clearInterval(autoGCTimer);
    autoGCTimer = undefined;
  }
  queryAtom.change("queries", {});
};
