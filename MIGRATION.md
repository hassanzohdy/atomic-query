# Migration — @mongez/atomic-query

## First release (0.1.0)

This is the **initial published version** of `@mongez/atomic-query`. The library was previously prototyped against a personal project but never released to npm, so there's no prior public version to migrate from.

The `CHANGELOG.md` documents the diff against that pre-release prototype (every bug fixed during the rewrite). If you were testing against the prototype source, the changes that matter are:

### Bug fixes that change behavior

- `invalidate({ queryKey: ["users", 1] })` no longer also invalidates `["users", 10]`, `["users", 100]`, etc.
- `useQuery` no longer issues duplicate fetches when multiple components mount with the same `queryKey` in the same render.
- Hash collisions between `["users", "1|2"]` and `["users", 1, 2]` are gone (canonical JSON instead of pipe-joined).
- `useQuery` no longer mutates state during render (Strict Mode safe).
- `onQueryChange` now fires on first-create and on destroy (previously it required a prior `oldQuery` and missed both edges).
- `isLoading` and `isFetching` are now separate. `isLoading` is true only during the first fetch; `isFetching` is true during any fetch (initial or background).
- `destroyQuery` aborts in-flight fetches.
- `garbageCollect` evicts based on `lastAccessed` and observer count, not `lastModified` — actively-used queries are no longer GC'd.

### API shape

- `queryFn` is `({ signal }) => Promise<T>` (was `() => Promise<T>`). The signal is non-optional in the type; consumers can ignore it.
- `Query.data` is `T | undefined` (was `T`, with a runtime `null` initial). The type now honestly reflects the runtime.
- `updateQueryData(key, (old: T | undefined) => T)` updater receives `T | undefined` (was `T`).
- `onQueryChange` callback receives `Query | undefined` for both arguments.
- The five formerly-self-recursive cache methods (`clearCache`, `getCacheStats`, `garbageCollect`, `limitCacheSize`, `setupAutoGC`) now work.
- `removeAll` was removed from the array helpers — it was the only non-mutating sibling, which confused callers. Use `queryAtom.remove(key, item)` or `updateQueryData(key, old => old.filter(...))`.

### SSR

The package is **client-only**. Every file carries `"use client"` and the `exports` map declares `"react-server": null`. Server components cannot import it directly — the bundler will reject the import.

For initial data, fetch in your framework's loader (Next.js server component, Remix `loader`, TanStack Start `loader`) and pass the result to `<HydrateQueries entries={[...]}>`. See the [README](./README.md) for framework-specific examples.

## Coming from TanStack Query

A rough conceptual map:

| TanStack Query | @mongez/atomic-query |
|---|---|
| `useQuery({ queryKey, queryFn })` | `queryAtom.useQuery({ queryKey, queryFn })` |
| `useMutation({ mutationFn, onSuccess })` | `useMutation({ mutationFn, onSuccess })` |
| `useInfiniteQuery({ ..., getNextPageParam })` | `useInfiniteQuery({ ..., getNextPageParam })` |
| `useSuspenseQuery(...)` | `useSuspenseQuery(...)` |
| `queryClient.invalidateQueries({ queryKey })` | `queryAtom.invalidate({ queryKey })` |
| `queryClient.setQueryData(key, updater)` | `queryAtom.updateQueryData(key, updater)` |
| `queryClient.prefetchQuery(...)` | Fetch in your framework loader + `seedQuery(...)` |
| `<HydrationBoundary state={dehydrate(client)}>` | `<HydrateQueries entries={[...]}>` |
| `<QueryClientProvider client={queryClient}>` | Not required — `queryAtom` is a module-level singleton (client-only) |

Three things TanStack Query has that atomic-query doesn't:

1. **Server-side fetching primitives.** That belongs to your meta-framework loader.
2. **Per-request `QueryClient`.** Same reason — client-only means one cache per browser tab is the right unit.
3. **Persistent cache adapters.** Use `@mongez/cache` directly for now; a `persist` story may land on atom in a future minor.

If those gaps matter for your app, stay on TanStack Query. If you're already on `@mongez/atom` and want one consistent mental model for ephemeral and server state, this is the right tool.
