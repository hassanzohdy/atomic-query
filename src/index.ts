/**
 * @fileoverview Public barrel for `@mongez/atomic-query`.
 *
 * Client-only state management for server data. Built on
 * `@mongez/react-atom`, designed to play with your meta-framework's
 * loader for the initial render rather than duplicate its job.
 *
 * The package is marked `"react-server": null` in its exports map and
 * every source file carries `"use client"` — server components cannot
 * import it directly. For initial data, fetch in your framework loader
 * and pass the result to {@link HydrateQueries}.
 *
 * @example
 * ```tsx
 * "use client";
 * import { queryAtom } from "@mongez/atomic-query";
 *
 * function UserList() {
 *   const { data, isLoading } = queryAtom.useQuery({
 *     queryKey: ["users"],
 *     queryFn: ({ signal }) => fetch("/api/users", { signal }).then(r => r.json()),
 *     staleTime: 60_000,
 *   });
 *   if (isLoading) return <Spinner />;
 *   return <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
 * }
 * ```
 */

export { queryAtom } from "./query-atom";
export { HydrateQueries, type HydrateQueriesProps } from "./hydrate";
export {
  useMutation,
  type MutationStatus,
  type UseMutationOptions,
  type UseMutationResult,
} from "./mutation";
export {
  useInfiniteQuery,
  type InfiniteQueryData,
  type InfiniteQueryFnContext,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
} from "./infinite";
export { useSuspenseQuery } from "./suspense";

// Type exports
export type {
  AddQueryOptions,
  CacheStats,
  GenericObject,
  InvalidateOptions,
  Query,
  QueryActions,
  QueryChangeType,
  QueryChangeTypeToValue,
  QueryKey,
  QueryPayload,
  QueryState,
  SeedEntry,
} from "./types";

// Hook re-exports for callers who prefer functions over methods on the atom.
export {
  useDataChange,
  useErrorChange,
  useLoadChange,
  useQuery,
  useQueryChange,
} from "./hooks";

// Imperative-API re-exports for use outside React.
export {
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

// Array-manipulation re-exports.
export {
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

// Low-level utilities exposed for advanced use.
export {
  matchesQueryPrefix,
  parseQueryKey,
  refetch,
  refetchBackground,
  refetchMultiple,
  refetchMultipleBackground,
  runInBackground,
  serializeQueryKey,
} from "./utils";
