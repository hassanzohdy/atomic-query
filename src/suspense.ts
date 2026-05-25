"use client";
/**
 * @fileoverview `useSuspenseQuery` — a thin Suspense-aware wrapper over
 * `useQuery`.
 *
 * When the underlying query is still fetching and has no data, the hook
 * throws the in-flight promise; the React runtime treats that as
 * "suspend this tree." When the query errors, it throws the error so an
 * `ErrorBoundary` catches it. Otherwise it returns the data directly.
 *
 * Implementation note: the regular `useQuery` creates the cache entry
 * and kicks off the first fetch inside a `useEffect`. That effect never
 * runs when a component suspends mid-render (React unwinds without
 * committing), so a naïve Suspense wrapper would loop on the fallback
 * forever. To make this work, we synchronously seed the cache entry +
 * start the fetch during render the first time a hashKey is seen.
 * Render-time side effects are normally discouraged, but cache-init is
 * idempotent — duplicate calls are no-ops thanks to the in-flight
 * promise dedup.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { queryAtom } from "./query-atom";
import type { AddQueryOptions, Query, QueryKey } from "./types";
import {
  ensureAutoGCStarted,
  loadQuery,
  parseQueryKey,
  refresh,
  setLatestQueryFn,
} from "./utils";

/**
 * Promise registry: one resolver per `hashKey` waiting on the next
 * settled state. The hook subscribes to the query and resolves the
 * promise when it transitions out of "loading"/"idle".
 */
const pendingPromises = new Map<string, Promise<unknown>>();

function pendingPromiseFor(hashKey: string): Promise<unknown> {
  const existing = pendingPromises.get(hashKey);
  if (existing) return existing;
  const promise = new Promise<unknown>(resolve => {
    const sub = queryAtom.onChange(value => {
      const next = value.queries[hashKey];
      if (next && next.state !== "loading" && next.state !== "idle") {
        sub.unsubscribe();
        pendingPromises.delete(hashKey);
        resolve(next);
      }
    });
    // If the query already settled before we subscribed (e.g. cached
    // success), resolve immediately so the hook doesn't suspend.
    const current = queryAtom.get("queries")[hashKey];
    if (
      current &&
      current.state !== "loading" &&
      current.state !== "idle"
    ) {
      sub.unsubscribe();
      pendingPromises.delete(hashKey);
      resolve(current);
    }
  });
  pendingPromises.set(hashKey, promise);
  return promise;
}

/**
 * Synchronously create the cache entry and kick off the first fetch.
 * Idempotent — a second call for the same hash returns without doing
 * anything because the entry now exists.
 */
function initSuspenseQuery<T>(
  hashKey: string,
  options: AddQueryOptions<T>,
): void {
  if (queryAtom.get("queries")[hashKey]) return;

  ensureAutoGCStarted();
  setLatestQueryFn(hashKey, options.queryFn as any);

  const now = Date.now();
  const initial: Query<T> = {
    data: undefined,
    queryFn: options.queryFn as any,
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
    options: {
      retry: options.retry,
      retryDelay: options.retryDelay,
      retryCondition: options.retryCondition,
      staleTime: options.staleTime,
      gcTime: options.gcTime,
      refetchOnMount: options.refetchOnMount,
      refetchOnWindowFocus: options.refetchOnWindowFocus,
      refetchOnReconnect: options.refetchOnReconnect,
    },
    onSuccess: options.onSuccess as any,
    onError: options.onError as any,
  } as Query<T>;
  refresh(initial);

  // Fire-and-forget. Errors land in cache state; we read them on the
  // next render to throw the right thing.
  void loadQuery(initial, "normal").catch(() => {});
}

/**
 * Suspense-mode query hook. Throws a promise while loading, throws the
 * error when failed, returns the query (with `data` typed as `T`,
 * non-undefined) when successful.
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const q = useSuspenseQuery<User[]>({
 *     queryKey: ["users"],
 *     queryFn: ({ signal }) => fetch("/api/users", { signal }).then(r => r.json()),
 *   });
 *   return <ul>{q.data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
 * }
 *
 * <Suspense fallback={<Spinner />}>
 *   <ErrorBoundary fallback={<p>Failed</p>}>
 *     <UserList />
 *   </ErrorBoundary>
 * </Suspense>
 * ```
 */
export function useSuspenseQuery<T>(
  options: AddQueryOptions<T>,
): Query<T> & { data: T } {
  // Stable hashKey from the structural shape (re-hash each render is
  // cheap and avoids stale closures over queryKey identity).
  const hashKey = parseQueryKey(options.queryKey);

  // Render-time init: ensure the cache entry exists and the fetch is
  // running. Without this, a suspended-from-first-render component
  // never commits its useEffect and never kicks off the fetch.
  initSuspenseQuery(hashKey, options);

  // Subscribe via useSyncExternalStore so subsequent transitions
  // (success / error / invalidate / refetch) re-render the component.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const sub = queryAtom.onChange((newVal, oldVal) => {
        if (newVal.queries[hashKey] !== oldVal.queries[hashKey]) onChange();
      });
      return () => sub.unsubscribe();
    },
    [hashKey],
  );
  const getSnapshot = useCallback(() => {
    return queryAtom.get("queries")[hashKey] as Query<T>;
  }, [hashKey]);

  const query = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Pin the in-flight promise across renders so React can coalesce
  // multiple suspends on the same hashKey.
  const promiseRef = useRef<Promise<unknown> | null>(null);

  if (query.isError) {
    promiseRef.current = null;
    throw query.error ?? new Error("[atomic-query] useSuspenseQuery failed");
  }

  if (query.data === undefined) {
    if (!promiseRef.current) {
      promiseRef.current = pendingPromiseFor(hashKey);
    }
    throw promiseRef.current;
  }

  promiseRef.current = null;
  return query as Query<T> & { data: T };
}

/** Avoid unused-import warning. */
void parseQueryKey;
export type { QueryKey };
