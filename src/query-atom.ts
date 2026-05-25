"use client";
/**
 * @fileoverview The singleton `queryAtom`.
 *
 * One module-level atom whose value holds every cached query. Atomic-query
 * is a client-only library (see the package's `react-server: null` exports
 * map), so the singleton is safe — there's no server context where two
 * concurrent requests could share its state.
 */
import { atom } from "@mongez/react-atom";
import {
  clear,
  pop,
  push,
  remove,
  removeByIndex,
  replace,
  reverse,
  shift,
  sort,
  unshift,
} from "./array-manipulation";
import {
  useDataChange,
  useErrorChange,
  useLoadChange,
  useQuery,
  useQueryChange,
} from "./hooks";
import {
  clearCache,
  destroyQuery,
  garbageCollect,
  getCacheStats,
  getData,
  getQuery,
  invalidate,
  invalidateAll,
  invalidateBackground,
  invalidateBackgroundAll,
  isStale,
  limitCacheSize,
  refetchMultipleQueries,
  refetchMultipleQueriesBackground,
  refetchQuery,
  refetchQueryBackground,
  seedQuery,
  setupAutoGC,
  updateQueryData,
} from "./query-actions";
import type {
  Query,
  QueryActions,
  QueryKey,
  QueryPayload,
} from "./types";
import { parseQueryKey } from "./utils";

/**
 * The cache. Components subscribe to slices of this via the hooks; the
 * imperative API operates on its value directly.
 */
export const queryAtom = atom<QueryPayload, QueryActions>({
  key: "atomic-query",
  default: {
    queries: {},
  },
  actions: {
    useQuery,
    invalidate,
    invalidateAll,
    invalidateBackground,
    invalidateBackgroundAll,
    updateQueryData,
    seedQuery,
    getData,
    getQuery,
    destroyQuery,
    isStale,
    refetchQuery,
    refetchMultipleQueries,
    refetchQueryBackground,
    refetchMultipleQueriesBackground,
    getCacheStats,
    clearCache,
    garbageCollect,
    limitCacheSize,
    setupAutoGC,

    /**
     * Fire `callback` on every transition of the named query, including:
     *   - initial create (oldQuery is undefined)
     *   - data/loading/error transitions
     *   - destroy (newQuery is undefined)
     *
     * The previous implementation required `oldQuery && newer.lastModified
     * > oldQuery.lastModified`, which silently dropped the first-load
     * transition and the destroy transition. This version fires whenever
     * the slice reference changes.
     */
    onQueryChange: (
      queryKey: QueryKey,
      callback: (
        query: Query | undefined,
        oldQuery: Query | undefined,
      ) => void,
    ) => {
      const hashKey = parseQueryKey(queryKey);
      return queryAtom.onChange((value, oldValue) => {
        const next = value.queries[hashKey];
        const prev = oldValue.queries[hashKey];
        if (next !== prev) callback(next, prev);
      });
    },

    useQueryChange,
    useLoadChange,
    useErrorChange,
    useDataChange,

    // Array manipulation
    push,
    unshift,
    pop,
    shift,
    replace,
    remove,
    removeByIndex,
    clear,
    sort,
    reverse,
  },
});
