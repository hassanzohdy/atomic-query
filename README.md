<div align="center">

# @mongez/atomic-query

**Client-side query cache for the `@mongez/atom` ecosystem — React-Query-style hooks built on top of `@mongez/react-atom`.**

[![npm](https://img.shields.io/npm/v/@mongez/atomic-query.svg)](https://www.npmjs.com/package/@mongez/atomic-query)
[![license](https://img.shields.io/npm/l/@mongez/atomic-query.svg)](LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@mongez/atomic-query.svg)](https://bundlephobia.com/package/@mongez/atomic-query)
[![downloads](https://img.shields.io/npm/dw/@mongez/atomic-query.svg)](https://www.npmjs.com/package/@mongez/atomic-query)

</div>

---

## Why @mongez/atomic-query?

[TanStack Query](https://tanstack.com/query) is the gold standard for server-state caching and remains the right pick when you're not already invested in `@mongez/atom`. [SWR](https://swr.vercel.app/) is leaner but skips mutations, list helpers, and structured invalidation. [Apollo Client](https://www.apollographql.com/docs/react/) is GraphQL-shaped and asks you to commit to its store. `@mongez/atomic-query` is the smallest layer that gives the atom ecosystem one consistent mental model for ephemeral and server state: queries, mutations, optimistic writes, segment-aware invalidation, in-flight dedup, AbortSignal propagation, and reference-counted GC — all on a single `queryAtom` you can read from any hook, event handler, or service. The package is intentionally client-only: SSR fetching is your framework's job, and `<HydrateQueries>` is the seam.

```tsx
"use client";
import { queryAtom } from "@mongez/atomic-query";

export function UserList() {
  const { data, isLoading } = queryAtom.useQuery<User[]>({
    queryKey: ["users"],
    queryFn: ({ signal }) => fetch("/api/users", { signal }).then(r => r.json()),
    staleTime: 60_000,
  });
  if (isLoading) return <Spinner />;
  return <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

---

## Features

| Feature | Description |
|---|---|
| **`useQuery` + `useMutation`** | Read-side cache hook and write-side imperative hook, with the React-Query callback lifecycle (`onMutate` / `onSuccess` / `onError` / `onSettled`). |
| **`useInfiniteQuery`** | Cursor or offset pagination with `fetchNextPage`, `hasNextPage`, `isFetchingNextPage`. Cached as `{ pages, pageParams }`. |
| **`useSuspenseQuery`** | Throws the in-flight promise so `<Suspense>` boundaries can render fallbacks; throws the error for `ErrorBoundary`. |
| **List mutation helpers** | `push`, `unshift`, `pop`, `shift`, `replace`, `remove`, `removeByIndex`, `clear`, `sort`, `reverse` — atomic, immutable, no refetch. |
| **Segment-aware invalidation** | `invalidate(["users", 1])` matches `["users", 1, "profile"]` but never `["users", 10]`. |
| **Concurrent fetch dedup** | Three components mounting the same key share one network call via an in-flight promise map. |
| **AbortSignal propagation** | Every `queryFn` and `mutationFn` receives `{ signal }`. Stale fetches abort when a newer fetch starts or `destroyQuery(key)` runs. |
| **Reference-counted GC** | Auto-starts on the first `useQuery`. Evicts unobserved entries past `gcTime`; observed queries are never collected. |
| **SSR via `<HydrateQueries>`** | Seed the cache from your framework loader (Next.js server component, Remix `loader`, TanStack Start `loader`). No flash, no hydration mismatch. |
| **Granular subscriptions** | `useLoadChange`, `useErrorChange`, `useDataChange`, `useQueryChange(key, field)` — re-render only when one named field flips. |
| **Client-only enforcement** | Every file `"use client"`. Exports map marks `react-server: null`. RSC bundlers refuse the import. |
| **TypeScript-first** | `Query<T>`, `AddQueryOptions<T>`, `UseMutationOptions<TData, TVars, TCtx>`, `InfiniteQueryData<TPage, TPageParam>`, full inference at call sites. |

---

## Installation

```sh
npm install @mongez/atomic-query
```

```sh
yarn add @mongez/atomic-query
```

```sh
pnpm add @mongez/atomic-query
```

Peer dependencies: `react >= 18`. Runtime dependencies: `@mongez/events`, `@mongez/react-atom`.

---

## Quick start

```tsx
"use client";
import { queryAtom } from "@mongez/atomic-query";

type User = { id: number; name: string };

export function UserList() {
  const { data, isLoading, isFetching, error } = queryAtom.useQuery<User[]>({
    queryKey: ["users"],
    queryFn: ({ signal }) =>
      fetch("/api/users", { signal }).then(r => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      {isFetching && <RefreshingBadge />}
      <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>
    </>
  );
}
```

That's the happy path. Everything below is depth on the same surface — one atom, one cache, one set of hooks.

---

## `queryAtom.useQuery(options)`

The flagship read-side hook. Subscribes to a query, kicks off a fetch when the data is missing or stale, re-renders on transitions.

```ts
queryAtom.useQuery<T>({
  // Required
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;

  // Callbacks
  onSuccess?: (data: T, query: Query<T>) => void;
  onError?: (error: any, query: Query<T>) => void;

  // Reactivity
  watch?: boolean;                                   // default true

  // Retry
  retry?: number;                                    // default 0
  retryDelay?: number | ((attempt: number) => number);
  retryCondition?: (error: any, attempt: number) => boolean;

  // Freshness
  staleTime?: number;                                // default 0 (always stale)
  gcTime?: number;                                   // default 5 * 60_000

  // Refetch triggers
  refetchOnMount?: boolean;                          // default true
  refetchOnWindowFocus?: boolean;                    // default false
  refetchOnReconnect?: boolean;                      // default false
}): Query<T>
```

### The `Query<T>` shape

| Field | Type | Meaning |
|---|---|---|
| `data` | `T \| undefined` | Cached value; `undefined` until the first successful fetch. |
| `isLoading` | `boolean` | `true` only during the FIRST fetch (no data yet). Use for skeletons. |
| `isFetching` | `boolean` | `true` during ANY fetch (initial or background). Use for "refreshing" indicators. |
| `isError` | `boolean` | The last attempt failed (post-retries). |
| `error` | `unknown \| null` | Error object from the last failed attempt. |
| `state` | `"idle" \| "loading" \| "error" \| "success"` | Coarse lifecycle. |
| `isRetrying` | `boolean` | Currently waiting between retry attempts. |
| `lastModified` | `number` | Timestamp of the last completed transition. |
| `lastSuccessAt` / `lastErrorAt` | `number \| undefined` | Timestamps. |
| `fetchCount` / `retryCount` / `maxRetries` | `number` | Counters. |
| `queryKey` / `hashKey` / `queryFn` | … | Stored on the entry. |

> **`isLoading` and `isFetching` are not the same.** `isLoading` is the first-fetch flag and stays `false` for every background refetch. A UI that ties a skeleton to `isLoading` and a small "refreshing" badge to `isFetching` is the intended split.

### Dependent keys

```tsx
const userId = useParams().id;
const { data } = queryAtom.useQuery<User>({
  queryKey: ["users", userId],
  queryFn: ({ signal }) =>
    fetch(`/api/users/${userId}`, { signal }).then(r => r.json()),
});
```

Changing `userId` swaps the cache slice. The previous entry stays in the cache (eligible for GC when no consumer holds it).

### Retry with exponential backoff

```tsx
queryAtom.useQuery({
  queryKey: ["orders"],
  queryFn,
  retry: 3,
  retryDelay: attempt => 1000 * 2 ** attempt, // 1s, 2s, 4s
  retryCondition: err => !(err instanceof TypeError),
});
```

### Granular field subscriptions

When a component only cares about one field on a query, subscribe to that field — re-renders only fire when THAT field changes, not when siblings on the same entry change.

```ts
const isLoading = queryAtom.useLoadChange(["users"]);
const error     = queryAtom.useErrorChange(["users"]);
const data      = queryAtom.useDataChange<User[]>(["users"]);
const fetching  = queryAtom.useQueryChange(["users"], "isFetching");
```

### Non-React subscription

```ts
const sub = queryAtom.onQueryChange(["users"], (next, prev) => {
  // Fires on create (prev === undefined), update, and destroy (next === undefined).
});
sub.unsubscribe();
```

---

## `useMutation(options)`

Write-side imperative hook with success/error/settled callbacks and a status surface for inline UI.

```ts
useMutation<TData, TVariables, TContext>({
  mutationFn: (variables: TVariables, ctx: { signal: AbortSignal }) =>
    Promise<TData>;
  onMutate?: (variables: TVariables) => TContext | Promise<TContext>;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) =>
    void | Promise<void>;
  onError?: (error: unknown, variables: TVariables, context: TContext | undefined) =>
    void | Promise<void>;
  onSettled?: (
    data: TData | undefined,
    error: unknown,
    variables: TVariables,
    context: TContext | undefined,
  ) => void | Promise<void>;
})
```

| Field | Type | Meaning |
|---|---|---|
| `mutate` | `(vars) => Promise<TData>` | Fire the mutation; returns a promise that resolves to the result. |
| `mutateAsync` | `(vars) => Promise<TData>` | Alias for `mutate` — identical semantics. |
| `reset` | `() => void` | Clear local state and abort any in-flight call. |
| `status` | `"idle" \| "pending" \| "error" \| "success"` | Current lifecycle state. |
| `isPending` / `isError` / `isSuccess` / `isIdle` | `boolean` | Derived flags. |
| `data` | `TData \| undefined` | Result of the last successful call. |
| `error` | `unknown` | Error from the last failed call. |
| `variables` | `TVariables \| undefined` | Variables passed to the last call. |

```tsx
"use client";
import { useMutation, queryAtom } from "@mongez/atomic-query";

function CreateUserForm() {
  const createUser = useMutation<User, { name: string }>({
    mutationFn: async ({ name }, { signal }) =>
      fetch("/api/users", {
        method: "POST",
        body: JSON.stringify({ name }),
        signal,
      }).then(r => r.json()),

    onSuccess: created => {
      queryAtom.push(["users"], created);
    },

    onSettled: () => {
      queryAtom.invalidate({ queryKey: ["users", "stats"] });
    },
  });

  return (
    <button
      disabled={createUser.isPending}
      onClick={() => createUser.mutate({ name: "Alice" })}>
      {createUser.isPending ? "Creating…" : "Create user"}
    </button>
  );
}
```

> **A second `mutate` call aborts the previous in-flight one.** Unmounting also aborts. The hook checks `controller.signal.aborted` before invoking the callbacks — aborted calls do NOT fire `onSuccess` / `onError` / `onSettled`.

> **Mutations don't write to the cache themselves.** The hook tracks its own local `status`/`data`/`error`. Cache interaction is always explicit — call `queryAtom.updateQueryData`, `queryAtom.push`, `queryAtom.invalidate`, etc. inside the callbacks.

---

## `useInfiniteQuery(options)`

Cursor or offset pagination. The cached value is `{ pages: TPage[]; pageParams: TPageParam[] }`. Each `fetchNextPage()` computes the next cursor via `getNextPageParam` and appends to both arrays.

```ts
useInfiniteQuery<TPage, TPageParam>({
  queryKey: QueryKey;
  queryFn: (ctx: { pageParam: TPageParam; signal: AbortSignal }) => Promise<TPage>;
  initialPageParam: TPageParam;
  getNextPageParam: (
    lastPage: TPage,
    allPages: TPage[],
    lastPageParam: TPageParam,
    allPageParams: TPageParam[],
  ) => TPageParam | undefined;
  // Plus every standard useQuery option:
  staleTime?, gcTime?, retry?, refetchOnMount?, refetchOnWindowFocus?, refetchOnReconnect?
})
```

| Extra field | Type | Meaning |
|---|---|---|
| `hasNextPage` | `boolean` | `getNextPageParam` returned a non-`undefined`, non-`null` value for the last page. |
| `isFetchingNextPage` | `boolean` | Local to the hook — separate from the cached query's `isFetching` (whole-query refetches like invalidation). |
| `fetchNextPage` | `() => Promise<void>` | Fetch and append the next page. |

```tsx
"use client";
import { useInfiniteQuery } from "@mongez/atomic-query";

type Page = { items: Post[]; nextCursor: number | null };

export function PostFeed() {
  const q = useInfiniteQuery<Page, number>({
    queryKey: ["posts", "feed"],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetch(`/api/posts?cursor=${pageParam}`, { signal }).then(r => r.json()),
    getNextPageParam: last => last.nextCursor ?? undefined,
  });

  const posts = q.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <>
      <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
      <button
        disabled={!q.hasNextPage || q.isFetchingNextPage}
        onClick={() => q.fetchNextPage()}>
        {q.isFetchingNextPage ? "Loading…" : q.hasNextPage ? "Load more" : "All loaded"}
      </button>
    </>
  );
}
```

> **Invalidation resets pagination.** `queryAtom.invalidate({ queryKey: ["posts", "feed"] })` refetches starting from page 1; the `pages` array collapses back to length 1. Bidirectional pagination is not yet supported — model it with your own state when needed.

---

## `useSuspenseQuery(options)`

Thin Suspense wrapper over `useQuery`. While loading and no data: throws the in-flight promise. On error: throws the error. On success: returns the query with `data` typed as `T`, not `T | undefined`.

```tsx
import { Suspense } from "react";
import { useSuspenseQuery } from "@mongez/atomic-query";

function UserList() {
  // `q.data` is `User[]`, not `User[] | undefined`.
  const q = useSuspenseQuery<User[]>({
    queryKey: ["users"],
    queryFn: ({ signal }) =>
      fetch("/api/users", { signal }).then(r => r.json()),
  });
  return <ul>{q.data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}

<ErrorBoundary fallback={<p>Failed to load</p>}>
  <Suspense fallback={<Spinner />}>
    <UserList />
  </Suspense>
</ErrorBoundary>
```

> **Order matters.** `ErrorBoundary` must wrap `Suspense` so it catches throws from the suspended subtree. Without an `ErrorBoundary`, a failed `useSuspenseQuery` bubbles to the React root and crashes the tree.

> **Render-time side effects are intentional.** Unlike `useQuery`, the cache entry is created and the fetch is kicked off synchronously during render. A component that suspends from first render never commits its `useEffect`, so an effect-based init would never run. The render-time init is idempotent — a second call for the same hashKey is a no-op.

---

## SSR integration — `<HydrateQueries>`

atomic-query is client-only. Server-side data fetching is your framework's job. The seam is `<HydrateQueries>`: the loader fetches, you pass the result, the cache picks it up on first render.

```tsx
import { HydrateQueries, type SeedEntry } from "@mongez/atomic-query";

<HydrateQueries entries={[
  { queryKey: ["users"], data: usersFromLoader },
  { queryKey: ["currentUser"], data: currentUserFromLoader, freshFor: 60_000 },
]}>
  <App />
</HydrateQueries>
```

Each entry seeds the cache with `state: "success"`, `isLoading: false`. Consumers using the same `queryKey` see the seeded value on first render — no flash, no spinner, no refetch as long as it's fresh per `freshFor` / `staleTime`.

### Next.js (App Router)

```tsx
// app/users/page.tsx — server component
import { HydrateQueries } from "@mongez/atomic-query";
import { UserListClient } from "./UserListClient";

export default async function UsersPage() {
  const users = await db.users.findMany();
  return (
    <HydrateQueries entries={[{ queryKey: ["users"], data: users }]}>
      <UserListClient />
    </HydrateQueries>
  );
}
```

```tsx
// app/users/UserListClient.tsx
"use client";
import { queryAtom } from "@mongez/atomic-query";

export function UserListClient() {
  const { data } = queryAtom.useQuery<User[]>({
    queryKey: ["users"],
    queryFn: ({ signal }) =>
      fetch("/api/users", { signal }).then(r => r.json()),
    staleTime: 60_000,
  });
  return <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

### Remix

```tsx
import { json, useLoaderData } from "@remix-run/react";
import { HydrateQueries } from "@mongez/atomic-query";

export async function loader() {
  return json({ users: await db.users.findMany() });
}

export default function UsersRoute() {
  const { users } = useLoaderData<typeof loader>();
  return (
    <HydrateQueries entries={[{ queryKey: ["users"], data: users }]}>
      <UserList />
    </HydrateQueries>
  );
}
```

### TanStack Start

```tsx
import { createFileRoute } from "@tanstack/start";
import { HydrateQueries } from "@mongez/atomic-query";

export const Route = createFileRoute("/users")({
  loader: async () => ({ users: await db.users.findMany() }),
  component: UsersRoute,
});

function UsersRoute() {
  const { users } = Route.useLoaderData();
  return (
    <HydrateQueries entries={[{ queryKey: ["users"], data: users }]}>
      <UserList />
    </HydrateQueries>
  );
}
```

> **React Server Components cannot import this package.** Every file carries `"use client"` and the exports map declares `"react-server": null`. The bundler errors with a clear message if you try. That's intentional — server rendering is your framework's job; this is the client cache.

---

## Invalidation and refetch

Force matching queries to refetch in the background. Matching is **segment-aware**: invalidating `["users", 1]` matches `["users", 1, "profile"]` but never `["users", 10]`.

```ts
// Prefix match — refetches ["users"], ["users", 1], ["users", 1, "profile"], …
await queryAtom.invalidate({ queryKey: ["users"] });

// Exact match — refetches only ["users", 1]
await queryAtom.invalidate({ queryKey: ["users", 1], exact: true });

// Everything
await queryAtom.invalidateAll();

// Fire-and-forget (requestIdleCallback)
queryAtom.invalidateBackground({ queryKey: ["users"] });
queryAtom.invalidateBackgroundAll();
```

Imperative refetch from outside React:

```ts
await queryAtom.refetchQuery(["users"]);                 // throws if missing
await queryAtom.refetchMultipleQueries([["users"], ["posts"]]);
queryAtom.refetchQueryBackground(["users"]);
queryAtom.refetchMultipleQueriesBackground([["users"], ["posts"]]);
```

| Operation | Mode | Behavior |
|---|---|---|
| `invalidate(...)` | Silent | Sets `isFetching: true` but leaves `isLoading: false`. UI keeps current data on screen. |
| `invalidateAll()` | Silent | Same, for every query in the cache. |
| `invalidateBackground(...)` | Silent + idle | Scheduled via `requestIdleCallback`; doesn't block paint. |
| `refetchQuery(...)` | Normal | Throws if the key is not in the cache. Awaitable. |
| `refetchQueryBackground(...)` | Normal + idle | Fire-and-forget; swallows rejections. |

> **Segment-aware matching is strict.** `["users", 1]` does NOT match `["users", 10]` or `["users", 100]`. The match requires each JSON element at every position to be identical (the old prefix-string match that caught these false positives is gone).

> **`refetchQuery` throws if the key is missing.** This is intentional — it signals a programming error (refetching something that was never mounted). Use `queryAtom.getQuery(key)` to guard if the key may not exist.

---

## Direct cache reads and writes

For event handlers, services, route loaders — anywhere outside a React component — every operation is also exposed imperatively on `queryAtom`.

```ts
// Read
queryAtom.getQuery(["users"]);         // Query | undefined
queryAtom.getData(["users"]);          // T | undefined (just the data field)
queryAtom.isStale(["users"], 60_000);  // boolean

// Write (no refetch)
queryAtom.updateQueryData<User[]>(["users"], old => [...(old ?? []), newUser]);

// Seed (typically from a loader)
queryAtom.seedQuery({ queryKey: ["users"], data: usersFromServer });
queryAtom.seedQuery({ queryKey: ["users"], data: usersFromServer, freshFor: 60_000 });

// Remove
queryAtom.destroyQuery(["users"]);     // removes + aborts in-flight
queryAtom.clearCache();                // wipes everything, aborts all in-flight
```

> **`updateQueryData` is a no-op when the query does not exist yet.** It silently does nothing for keys that have never been loaded. Pre-populate with `seedQuery` if you need it to work before the first `useQuery` mount.

---

## List mutation helpers

When your cached value is an array, mutate it directly through the cache. Each helper is immutable under the hood, flows through `updateQueryData`, and produces a single atomic cache write — subscribers re-render once, no refetch fires.

```ts
queryAtom.push(["users"], newUser);                                  // append
queryAtom.unshift(["users"], newUser);                               // prepend
queryAtom.pop(["users"]);                                            // drop last
queryAtom.shift(["users"]);                                          // drop first
queryAtom.replace(["users"], 0, updatedUser);                        // overwrite at index
queryAtom.removeByIndex(["users"], 3);                               // splice out at index
queryAtom.remove(["users"], userToRemove);                           // strict-equality filter
queryAtom.clear(["users"]);                                          // []
queryAtom.sort(["users"], (a, b) => a.name.localeCompare(b.name));   // stable sort, new array
queryAtom.reverse(["users"]);                                        // reverse, new array
```

Each helper is also exported as a top-level function:

```ts
import { push, unshift, pop, remove, sort } from "@mongez/atomic-query";
push(["users"], newUser);
```

| Helper | Signature | What it does |
|---|---|---|
| `push` | `(key, item)` | Append one item to the end. |
| `unshift` | `(key, item)` | Prepend one item to the start. |
| `pop` | `(key)` | Remove the last item. |
| `shift` | `(key)` | Remove the first item. |
| `replace` | `(key, index, item)` | Replace the item at `index`. |
| `removeByIndex` | `(key, index)` | Remove the item at `index`. |
| `remove` | `(key, item)` | Remove every occurrence by strict equality. |
| `clear` | `(key)` | Empty the list. |
| `sort` | `(key, compareFn)` | Sort into a new array and commit. |
| `reverse` | `(key)` | Reverse into a new array and commit. |

> **`remove(key, item)` uses strict equality (`!==`).** For object items this is reference equality, not deep equality. For "remove by id" patterns, use `removeByIndex` after `findIndex`, or use `updateQueryData` with `.filter()`.

> **Helpers no-op on `undefined`.** If the query hasn't loaded yet, the helpers treat the value as `[]` rather than throwing. You can fire optimistic mutations without first checking that the query has resolved.

---

## Cache lifecycle and GC

```ts
// Stats
const stats = queryAtom.getCacheStats();
// { totalQueries, loadingQueries, errorQueries, successfulQueries, totalDataSize }

// GC (manual)
queryAtom.garbageCollect(300_000);     // remove entries unobserved > 5 min; returns count removed
queryAtom.limitCacheSize(50);          // evict least-recently-accessed until ≤ 50 entries

// Auto-GC (starts automatically on first useQuery)
const stop = queryAtom.setupAutoGC(
  60_000,   // interval ms — default 60_000
  300_000,  // gcTime ms (unobserved threshold) — default 5 * 60_000
  100,      // maxQueries — default 100
);
// Stop:
stop();
```

| Setting | Default | Effect |
|---|---|---|
| `interval` | `60_000` ms | How often the GC loop runs. |
| `gcTime` | `5 * 60_000` ms | A query unobserved for this long is eligible for eviction. |
| `maxQueries` | `100` | Soft cap; the least-recently-accessed unobserved entries get evicted to honour it. |

> **GC respects observer counts.** A query with mounted consumers is never collected, even if its data is old. Only queries with zero observers since `gcTime` ms ago are evicted. The previous version GC'd actively-used queries (it used `lastModified` instead of `lastAccessed`); the current implementation uses both `lastAccessed` AND observer count.

> **`clearCache()` aborts every in-flight fetch.** Components still mounted that own queries re-enter the `idle` state and re-fetch on their next render cycle or when next observed.

---

## How invalidation matches keys

Cache keys are hashed via canonical JSON serialization with sorted object keys. Two consequences:

- `["users", { role: "admin", active: true }]` and `["users", { active: true, role: "admin" }]` hash to the **same** entry.
- `["users", "1|2"]` and `["users", 1, 2]` hash to **different** entries.

Partial invalidation matches at JSON-array boundaries: `["users", 1]` matches `["users", 1, "profile"]` because the child extends past the prefix's closing bracket. It does not match `["users", 10]` because `10` is a different complete element.

```
Invalidating ["users", 1] matches:
  ["users", 1]                    yes  (exact)
  ["users", 1, "profile"]         yes  (extends the prefix)
  ["users", 1, { role: "admin" }] yes

Does NOT match:
  ["users", 10]                   no   (10 is not 1 at that position)
  ["users", 100]                  no
  ["posts"]                       no
```

---

## Recipes

### Optimistic update with rollback

Reach for this when a mutation should reflect in the UI immediately and the failure mode is "undo the optimistic change if the server rejects."

```tsx
"use client";
import { useMutation, queryAtom } from "@mongez/atomic-query";

type User = { id: number; name: string };

function RenameUser({ id, currentName }: { id: number; currentName: string }) {
  const renameUser = useMutation<
    User,
    { id: number; name: string },
    { previous: User[] | undefined }
  >({
    // 1. Snapshot the cache and apply the optimistic change before the request fires.
    onMutate: ({ id, name }) => {
      const previous = queryAtom.getData(["users"]) as User[] | undefined;
      queryAtom.updateQueryData<User[]>(["users"], old =>
        (old ?? []).map(u => (u.id === id ? { ...u, name } : u)),
      );
      return { previous };
    },

    mutationFn: ({ id, name }, { signal }) =>
      fetch(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
        signal,
      }).then(r => r.json()),

    // 2. On error, restore the snapshot.
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryAtom.updateQueryData(["users"], () => ctx.previous!);
      }
    },

    // 3. On success, replace the optimistic patch with the canonical server record.
    onSuccess: serverUser => {
      queryAtom.updateQueryData<User[]>(["users"], old =>
        (old ?? []).map(u => (u.id === serverUser.id ? serverUser : u)),
      );
    },
  });

  return (
    <button onClick={() => renameUser.mutate({ id, name: prompt("New name?", currentName)! })}>
      Rename
    </button>
  );
}
```

### Append after create, remove after delete

Reach for this when a list cache should mirror create / delete operations without round-tripping the whole list.

```tsx
"use client";
import { useMutation, queryAtom } from "@mongez/atomic-query";

type Post = { id: number; title: string };

function PostActions() {
  const createPost = useMutation<Post, { title: string }>({
    mutationFn: ({ title }, { signal }) =>
      fetch("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title }),
        signal,
      }).then(r => r.json()),

    onSuccess: created => {
      queryAtom.push(["posts"], created);
    },
  });

  const deletePost = useMutation<void, number>({
    mutationFn: (id, { signal }) =>
      fetch(`/api/posts/${id}`, { method: "DELETE", signal }).then(() => undefined),

    // Remove by id — strict-equality `remove` doesn't help with object items.
    onSuccess: (_data, id) => {
      queryAtom.updateQueryData<Post[]>(["posts"], old =>
        (old ?? []).filter(p => p.id !== id),
      );
    },
  });

  return (
    <>
      <button onClick={() => createPost.mutate({ title: "Hello" })}>Create</button>
      <button onClick={() => deletePost.mutate(42)}>Delete #42</button>
    </>
  );
}
```

### Infinite scroll with cursor pagination

Reach for this when the API returns a cursor for the next page and you want a "Load more" button or a scroll observer.

```tsx
"use client";
import { useInfiniteQuery } from "@mongez/atomic-query";

type Post = { id: number; title: string };
type PostPage = { items: Post[]; nextCursor: number | null };

export function PostFeed() {
  const q = useInfiniteQuery<PostPage, number>({
    queryKey: ["posts", "feed"],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetch(`/api/posts?cursor=${pageParam}`, { signal }).then(r => r.json()),
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const posts = q.data?.pages.flatMap(p => p.items) ?? [];

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <>
      <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
      <button
        disabled={!q.hasNextPage || q.isFetchingNextPage}
        onClick={() => q.fetchNextPage()}>
        {q.isFetchingNextPage ? "Loading…" : q.hasNextPage ? "Load more" : "All loaded"}
      </button>
    </>
  );
}
```

### Hover-to-prefetch a route

Reach for this when you want a link to feel instant: warm the cache when the user hovers, render the destination from the cache on click.

```tsx
"use client";
import Link from "next/link";
import { queryAtom } from "@mongez/atomic-query";

type User = { id: number; name: string };

async function prefetchUser(id: number) {
  // Skip if already in cache and fresh.
  if (!queryAtom.isStale(["users", id], 60_000)) return;

  const user: User = await fetch(`/api/users/${id}`).then(r => r.json());
  queryAtom.seedQuery({
    queryKey: ["users", id],
    data: user,
    freshFor: 60_000,
  });
}

export function UserLink({ user }: { user: User }) {
  return (
    <Link
      href={`/users/${user.id}`}
      onMouseEnter={() => prefetchUser(user.id)}>
      {user.name}
    </Link>
  );
}
```

### Real-time invalidation from a WebSocket

Reach for this when a server-sent event should evict a slice of the cache so the next read pulls the freshest data. `invalidateBackground` keeps the wakeup off the critical path.

```ts
"use client";
import { useEffect } from "react";
import { queryAtom } from "@mongez/atomic-query";

type ServerEvent =
  | { type: "user.updated"; id: number }
  | { type: "user.deleted"; id: number }
  | { type: "orders.changed" };

export function useRealtimeSync() {
  useEffect(() => {
    const ws = new WebSocket("/realtime");
    ws.onmessage = event => {
      const msg: ServerEvent = JSON.parse(event.data);
      switch (msg.type) {
        case "user.updated":
          queryAtom.invalidateBackground({ queryKey: ["users", msg.id] });
          break;
        case "user.deleted":
          queryAtom.destroyQuery(["users", msg.id]);
          queryAtom.invalidateBackground({ queryKey: ["users"] });
          break;
        case "orders.changed":
          queryAtom.invalidateBackground({ queryKey: ["orders"] });
          break;
      }
    };
    return () => ws.close();
  }, []);
}
```

### Suspense with granular fallbacks

Reach for this when distinct chunks of the page can render independently and one slow query shouldn't block the others.

```tsx
import { Suspense } from "react";
import { useSuspenseQuery } from "@mongez/atomic-query";

function HeaderUser() {
  const q = useSuspenseQuery<User>({
    queryKey: ["currentUser"],
    queryFn: ({ signal }) => fetch("/api/me", { signal }).then(r => r.json()),
  });
  return <span>Hello, {q.data.name}</span>;
}

function OrderFeed() {
  const q = useSuspenseQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: ({ signal }) => fetch("/api/orders", { signal }).then(r => r.json()),
  });
  return <ul>{q.data.map(o => <li key={o.id}>{o.title}</li>)}</ul>;
}

export function Dashboard() {
  return (
    <ErrorBoundary fallback={<p>Something went wrong</p>}>
      <Suspense fallback={<HeaderSkeleton />}>
        <HeaderUser />
      </Suspense>
      <Suspense fallback={<FeedSkeleton />}>
        <OrderFeed />
      </Suspense>
    </ErrorBoundary>
  );
}
```

### Reset the cache on logout

Reach for this when a user signs out and you want every cached query gone, every in-flight fetch aborted, and the next render to start fresh.

```ts
"use client";
import { useMutation, queryAtom } from "@mongez/atomic-query";

export function useLogout() {
  return useMutation<void, void>({
    mutationFn: async (_vars, { signal }) => {
      await fetch("/api/logout", { method: "POST", signal });
    },
    onSettled: () => {
      // Wipe every cached entry and abort every in-flight fetch.
      queryAtom.clearCache();
    },
  });
}
```

### Migrating from TanStack Query

A rough conceptual map for porting an existing TanStack Query codebase. The hook signatures and lifecycle are close enough that most call sites need a one-line import change and a key rename.

| TanStack Query | @mongez/atomic-query |
|---|---|
| `useQuery({ queryKey, queryFn })` | `queryAtom.useQuery({ queryKey, queryFn })` |
| `useMutation({ mutationFn, onSuccess, ... })` | `useMutation({ mutationFn, onSuccess, ... })` |
| `useInfiniteQuery({ ..., getNextPageParam })` | `useInfiniteQuery({ ..., getNextPageParam })` |
| `useSuspenseQuery(...)` | `useSuspenseQuery(...)` |
| `queryClient.invalidateQueries({ queryKey })` | `queryAtom.invalidate({ queryKey })` |
| `queryClient.setQueryData(key, updater)` | `queryAtom.updateQueryData(key, updater)` |
| `queryClient.prefetchQuery(...)` | Fetch in your framework loader + `seedQuery(...)` |
| `<HydrationBoundary state={dehydrate(client)}>` | `<HydrateQueries entries={[...]}>` |
| `<QueryClientProvider client={queryClient}>` | Not required — `queryAtom` is a module-level singleton (client-only). |

Three things TanStack Query has that atomic-query doesn't:

1. **Server-side fetching primitives.** That belongs to your meta-framework loader.
2. **Per-request `QueryClient`.** Same reason — client-only means one cache per browser tab is the right unit.
3. **Persistent cache adapters.** Use [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) directly for ad-hoc persistence; a `persist` slot may land on atom in a future minor.

---

## Related packages

| Package | Use when you need |
|---|---|
| [`@mongez/atom`](https://github.com/hassanzohdy/atom) | The framework-agnostic atom primitive that powers atomic-query. Reach for it when you want ephemeral UI state with the same mental model as your cached server state. |
| [`@mongez/react-atom`](https://github.com/hassanzohdy/mongez-react-atom) | React bindings for `@mongez/atom`. atomic-query depends on it directly — installing this package pulls it in. |
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) | A pluggable cache layer (localStorage / sessionStorage / in-memory / encrypted) for ad-hoc persistence. Useful when you need disk-backed storage for values derived from queries. |
| [`@mongez/events`](https://github.com/hassanzohdy/events) | Cross-feature pub/sub. atomic-query uses it internally for `onQueryChange`; the same `EventSubscription` shape comes back from any subscription. |

---

## Further reading

- [`llms-full.txt`](./llms-full.txt) — exhaustive single-file API reference for tool-assisted development.
- [`llms.txt`](./llms.txt) — index of docs and reference pages (the LLM-friendly site map).
- [`CHANGELOG.md`](./CHANGELOG.md) — release notes and documented quirks.
- [`MIGRATION.md`](./MIGRATION.md) — upgrade notes, including the conceptual map from TanStack Query.
- [`skills/`](./skills) — per-topic deep-dives (overview, queries, mutations, cache, list helpers, SSR, suspense, infinite, invalidation).

---

## License

MIT — see [LICENSE](./LICENSE).
