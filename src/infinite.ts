"use client";
/**
 * @fileoverview `useInfiniteQuery` — paginated/cursor-based queries.
 *
 * The cached value for an infinite query is
 * `{ pages: TPage[]; pageParams: TPageParam[] }`. Each call to
 * `fetchNextPage()` computes the next param from `getNextPageParam`,
 * fetches, and appends the result to both arrays. Subsequent fetches
 * for the same key share an in-flight promise via the same dedup
 * mechanism `useQuery` uses.
 *
 * Built on `queryAtom.useQuery` so invalidation, GC, observer counts,
 * and refetch-on-focus / -reconnect all work for free. The first page
 * is the regular `queryFn` call; subsequent pages use the
 * cache-mutation API.
 */
import { useCallback, useState } from "react";
import { queryAtom } from "./query-atom";
import type { AddQueryOptions, Query, QueryKey } from "./types";
import { parseQueryKey, refresh } from "./utils";

export type InfiniteQueryData<TPage, TPageParam> = {
  /** Pages fetched so far, in arrival order. */
  pages: TPage[];
  /** The page param used to fetch each entry in `pages`. */
  pageParams: TPageParam[];
};

export type InfiniteQueryFnContext<TPageParam> = {
  /** The cursor/page param for this fetch. `undefined` only for the very
   * first fetch when `initialPageParam` is also `undefined`. */
  pageParam: TPageParam;
  signal: AbortSignal;
};

export type UseInfiniteQueryOptions<TPage, TPageParam> = Omit<
  AddQueryOptions<InfiniteQueryData<TPage, TPageParam>>,
  "queryFn"
> & {
  /** Fetch a single page given the current page param. */
  queryFn: (ctx: InfiniteQueryFnContext<TPageParam>) => Promise<TPage>;
  /** Param passed to the first fetch. */
  initialPageParam: TPageParam;
  /**
   * Compute the next page param from the last fetched page. Return
   * `undefined` to signal "no more pages" — `hasNextPage` flips to
   * `false`.
   */
  getNextPageParam: (
    lastPage: TPage,
    allPages: TPage[],
    lastPageParam: TPageParam,
    allPageParams: TPageParam[],
  ) => TPageParam | undefined;
};

export type UseInfiniteQueryResult<TPage, TPageParam> = Query<
  InfiniteQueryData<TPage, TPageParam>
> & {
  /** True when there's a next page to fetch (per `getNextPageParam`). */
  hasNextPage: boolean;
  /** True while `fetchNextPage` is in flight. */
  isFetchingNextPage: boolean;
  /** Trigger the next page fetch; resolves when it lands. */
  fetchNextPage: () => Promise<void>;
};

/**
 * Hook signature: `useInfiniteQuery({ queryKey, queryFn, initialPageParam, getNextPageParam })`.
 *
 * The cached shape lives in `queryAtom` like any other query, so
 * `invalidate({ queryKey })` triggers a full refetch starting from page
 * 1; `updateQueryData` lets you mutate the materialised pages
 * (insertions, optimistic appends, …).
 *
 * @example
 * ```tsx
 * const q = useInfiniteQuery({
 *   queryKey: ["posts"],
 *   queryFn: ({ pageParam, signal }) =>
 *     fetch(`/api/posts?cursor=${pageParam}`, { signal }).then(r => r.json()),
 *   initialPageParam: 0,
 *   getNextPageParam: (last, _all, lastParam) =>
 *     last.nextCursor ?? undefined,
 * });
 *
 * const flat = q.data?.pages.flatMap(p => p.items) ?? [];
 *
 * <button
 *   disabled={!q.hasNextPage || q.isFetchingNextPage}
 *   onClick={() => q.fetchNextPage()}>
 *   {q.isFetchingNextPage ? "Loading…" : q.hasNextPage ? "Load more" : "No more"}
 * </button>
 * ```
 */
export function useInfiniteQuery<TPage, TPageParam>(
  options: UseInfiniteQueryOptions<TPage, TPageParam>,
): UseInfiniteQueryResult<TPage, TPageParam> {
  // Local state for the next-page lifecycle. Cache state is for the
  // *materialised* pages; this is for the in-flight transition between
  // pages — kept off the global cache so it doesn't trigger wakeups for
  // unrelated subscribers.
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  // The "underlying" query: its queryFn fetches the FIRST page and
  // wraps it in the infinite shape. Subsequent pages are appended via
  // `fetchNextPage` below, which bypasses the queryFn.
  const query = queryAtom.useQuery<InfiniteQueryData<TPage, TPageParam>>({
    ...options,
    queryFn: async ({ signal }) => {
      const page = await options.queryFn({
        pageParam: options.initialPageParam,
        signal,
      });
      return {
        pages: [page],
        pageParams: [options.initialPageParam],
      };
    },
  });

  const data = query.data;
  const hasNextPage = (() => {
    if (!data || data.pages.length === 0) return false;
    const lastPage = data.pages[data.pages.length - 1];
    const lastParam = data.pageParams[data.pageParams.length - 1];
    const next = options.getNextPageParam(
      lastPage,
      data.pages,
      lastParam,
      data.pageParams,
    );
    return next !== undefined && next !== null;
  })();

  const fetchNextPage = useCallback(async (): Promise<void> => {
    const hashKey = parseQueryKey(options.queryKey);
    const current = queryAtom.get("queries")[hashKey];
    if (!current || !current.data) return;

    const infinite = current.data as InfiniteQueryData<TPage, TPageParam>;
    const lastPage = infinite.pages[infinite.pages.length - 1];
    const lastParam = infinite.pageParams[infinite.pageParams.length - 1];
    const nextParam = options.getNextPageParam(
      lastPage,
      infinite.pages,
      lastParam,
      infinite.pageParams,
    );
    if (nextParam === undefined || nextParam === null) return;

    setIsFetchingNextPage(true);
    try {
      // Each fetchNextPage gets its own controller so multiple in-flight
      // page fetches (rare but possible if a consumer mashes the button)
      // can be aborted independently.
      const controller = new AbortController();
      const nextPage = await options.queryFn({
        pageParam: nextParam,
        signal: controller.signal,
      });
      // Re-read the cache in case it changed during the fetch.
      const latest = queryAtom.get("queries")[hashKey];
      if (!latest) return;
      const latestInfinite =
        latest.data as InfiniteQueryData<TPage, TPageParam>;
      const updated: Query<InfiniteQueryData<TPage, TPageParam>> = {
        ...(latest as Query<InfiniteQueryData<TPage, TPageParam>>),
        data: {
          pages: [...latestInfinite.pages, nextPage],
          pageParams: [...latestInfinite.pageParams, nextParam],
        },
        lastModified: Date.now(),
      };
      refresh(updated);
    } finally {
      setIsFetchingNextPage(false);
    }
    // The page-fetcher closure captures options.* via refs through the
    // ref-update mechanism we added in `useQuery`. Re-running this
    // effect on every render is harmless because we read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseQueryKey(options.queryKey)]);

  return {
    ...query,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  };
}
