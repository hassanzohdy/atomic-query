# @mongez/atomic-query

> Client-side query cache for the `@mongez/atom` ecosystem. React-Query-style API, atoms-on-actions DX, single-page-app focus.

`@mongez/atomic-query` is a client-side cache for server state, built on top of [`@mongez/react-atom`](https://github.com/hassanzohdy/mongez-react-atom). It handles caching, deduplication, optimistic updates, list-mutation helpers, invalidation, background refetching, retries, and garbage collection — without trying to be your framework's data loader.

For initial server-rendered data, use your framework's loader (Next.js server component, Remix `loader`, TanStack Start `loader`) and hand the result to [`<HydrateQueries>`](#hydratequeries). For everything that happens after that — mutations, optimistic updates, list manipulation, refetches, invalidations — atomic-query takes over.

## Why this exists

There are excellent query libraries. [TanStack Query](https://tanstack.com/query) is the gold standard. So: why this?

- You're already using `@mongez/atom` and you want one consistent mental model for ephemeral and server state instead of running two cache systems side by side.
- You want **list mutation helpers built in** — `push`, `unshift`, `remove`, `replace`, `sort`, `reverse` — instead of writing `setQueryData(key, prev => [...prev, item])` everywhere.
- You want a smaller surface than TanStack Query. atomic-query intentionally skips features that the framework already provides (Suspense, server-side fetching, dehydrate/hydrate dance) and pushes that responsibility back to the loader.

If you're not on `@mongez/atom`, use TanStack Query. The integration cost of adopting atomic-query as a standalone library doesn't beat what's already there.

## Status

**Not yet released to npm.** This README documents the intended API; for current development state see [CHANGELOG.md](./CHANGELOG.md).

## Install

```sh
yarn add @mongez/atomic-query
# peer deps: @mongez/atom, @mongez/react-atom, react >= 18
```

## Client-only by design

Every file in this package carries `"use client"` and the package exports map declares `"react-server": null`. **React Server Components physically cannot import this package** — your bundler will error out with a clear message if you try. That's intentional: server rendering is your framework's job; this is the client cache.

## Quick start

```tsx
"use client";
import { queryAtom } from "@mongez/atomic-query";

export function UserList() {
  const { data, isLoading, error } = queryAtom.useQuery<User[]>({
    queryKey: ["users"],
    queryFn: ({ signal }) =>
      fetch("/api/users", { signal }).then(r => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <ul>
      {data?.map(u => <li key={u.id}>{u.name}</li>)}
    </ul>
  );
}
```

## SSR integration — `<HydrateQueries>`

The standard pattern: your framework fetches on the server, hands the result to atomic-query, client components below it skip the on-mount refetch.

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

The seeded data lands in the cache **synchronously during render**, so the client's first paint matches the server HTML — no flash, no hydration mismatch.

### Remix / TanStack Start

```tsx
export async function loader() {
  return json({ users: await db.users.findMany() });
}

export default function UsersRoute() {
  const { users } = useLoaderData<typeof loader>();
  return (
    <HydrateQueries entries={[{ queryKey: ["users"], data: users }]}>
      <UserListClient />
    </HydrateQueries>
  );
}
```

## API reference

### `queryAtom.useQuery(options)`

Subscribe to a query, kick off a fetch when needed, re-render on changes.

```ts
queryAtom.useQuery<T>({
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
  // Optional
  onSuccess?: (data: T, query: Query<T>) => void;
  onError?: (error: any, query: Query<T>) => void;
  watch?: boolean;                  // default true
  retry?: number;                   // default 0
  retryDelay?: number | ((attempt: number) => number);
  retryCondition?: (error: any, attempt: number) => boolean;
  staleTime?: number;               // default 0 (always stale)
  gcTime?: number;                  // default 5 * 60_000
  refetchOnMount?: boolean;         // default true
  refetchOnWindowFocus?: boolean;   // default false
  refetchOnReconnect?: boolean;     // default false
}): Query<T>
```

The returned `Query<T>` has:

| Field | Type | Meaning |
|---|---|---|
| `data` | `T \| undefined` | Cached value; `undefined` until the first successful fetch. |
| `isLoading` | `boolean` | `true` only during the FIRST fetch (no data yet). |
| `isFetching` | `boolean` | `true` during ANY fetch (initial or background). |
| `isError` | `boolean` | The last attempt failed. |
| `error` | `unknown \| null` | Error from the last failed attempt. |
| `state` | `"idle" \| "loading" \| "error" \| "success"` | Coarse lifecycle. |
| `isRetrying` | `boolean` | Currently waiting between retry attempts. |
| `lastModified`, `lastSuccessAt`, `lastErrorAt` | `number` | Timestamps. |
| `fetchCount`, `retryCount`, `maxRetries` | `number` | Counters. |

### `queryAtom.invalidate({ queryKey, exact? })`

Force matching queries to refetch in the background.

```ts
// Invalidate everything under ["users"]: ["users"], ["users", 1], ["users", 1, "profile"], …
await queryAtom.invalidate({ queryKey: ["users"] });

// Only the exact match
await queryAtom.invalidate({ queryKey: ["users", 1], exact: true });
```

**Matching is segment-aware.** Invalidating `["users", 1]` matches `["users", 1, "profile"]` but NOT `["users", 10]` or `["users", 100]`. The old prefix-string match (which would have falsely caught those siblings) is gone.

Other variants:
- `invalidateAll(): Promise<void>` — every query in the cache.
- `invalidateBackground(opts)` / `invalidateBackgroundAll()` — fire-and-forget via `requestIdleCallback`.

### `queryAtom.useMutation(options)`

Imperative side-effect hook with success/error/settled callbacks.

```tsx
const createUser = useMutation<User, { name: string }>({
  mutationFn: async ({ name }, { signal }) =>
    fetch("/api/users", {
      method: "POST",
      body: JSON.stringify({ name }),
      signal,
    }).then(r => r.json()),

  onMutate: async ({ name }) => {
    // Optional: snapshot for rollback. Whatever you return here is
    // passed to onError as the `context` argument.
    const previous = queryAtom.getData(["users"]) as User[] | undefined;
    queryAtom.updateQueryData<User[]>(["users"], old => [
      ...(old ?? []),
      { id: -1, name, optimistic: true } as User,
    ]);
    return { previous };
  },

  onError: (err, vars, ctx) => {
    // Rollback
    if (ctx?.previous) queryAtom.updateQueryData(["users"], () => ctx.previous);
  },

  onSuccess: created => {
    // Replace the optimistic stub with the real record
    queryAtom.updateQueryData<User[]>(["users"], old =>
      (old ?? []).map(u => (u.id === -1 ? created : u)),
    );
  },

  onSettled: () => {
    queryAtom.invalidate({ queryKey: ["users", "stats"] });
  },
});

<button
  disabled={createUser.isPending}
  onClick={() => createUser.mutate({ name: "Alice" })}>
  {createUser.isPending ? "Creating…" : "Create"}
</button>
```

A second `mutate` call aborts the previous in-flight call. Unmounting also aborts. Status surface: `isIdle | isPending | isSuccess | isError`.

### List manipulation helpers

When your query holds an array, mutate it directly through the cache. Every helper is immutable under the hood; the consumer of the query sees one atomic update.

```ts
queryAtom.push(["users"], newUser);
queryAtom.unshift(["users"], newUser);
queryAtom.pop(["users"]);
queryAtom.shift(["users"]);
queryAtom.replace(["users"], 0, updatedUser);
queryAtom.removeByIndex(["users"], 3);
queryAtom.remove(["users"], userToRemove);   // strict-equality filter
queryAtom.clear(["users"]);
queryAtom.sort(["users"], (a, b) => a.name.localeCompare(b.name));
queryAtom.reverse(["users"]);
```

Each helper is also exported as a top-level function (`import { push } from "@mongez/atomic-query"`).

### Optimistic updates without a mutation hook

When you just need to write to the cache without a side effect:

```ts
queryAtom.updateQueryData<User[]>(["users"], old => [...(old ?? []), newUser]);
```

### Seeding from a loader — `seedQuery`

`<HydrateQueries>` is the React wrapper. The underlying primitive is:

```ts
queryAtom.seedQuery<T>({
  queryKey: ["users"],
  data: usersFromLoader,
  freshFor?: 60_000,  // optional staleTime override
});
```

The seeded entry is marked `state: "success"`, `isLoading: false`. Consumers see it immediately on first render.

### Refetching

```ts
await queryAtom.refetchQuery(["users"]);                // throws if missing
await queryAtom.refetchMultipleQueries([["users"], ["posts"]]);
queryAtom.refetchQueryBackground(["users"]);            // fire-and-forget
queryAtom.refetchMultipleQueriesBackground([...]);
```

### Cache management

```ts
queryAtom.getQuery(["users"]);          // Query | undefined
queryAtom.getData(["users"]);           // T | undefined
queryAtom.destroyQuery(["users"]);      // removes + aborts in-flight
queryAtom.clearCache();                 // wipes everything
queryAtom.isStale(["users"], 60_000);   // boolean
queryAtom.getCacheStats();              // { totalQueries, loadingQueries, ... }
queryAtom.garbageCollect(gcTime);       // returns count removed
queryAtom.limitCacheSize(maxQueries);   // returns count removed
queryAtom.setupAutoGC(interval?, gcTime?, maxQueries?); // returns stop fn
```

Auto-GC starts automatically on the first `useQuery` call.

### Granular state subscriptions

When a component only cares about ONE field of a query:

```ts
const isLoading = queryAtom.useLoadChange(["users"]);
const err       = queryAtom.useErrorChange(["users"]);
const data      = queryAtom.useDataChange<User[]>(["users"]);
const flag      = queryAtom.useQueryChange(["users"], "isFetching");
```

Each is a `useSyncExternalStore` subscription on that one field — re-renders only fire when THAT field changes, not when other fields of the same query change.

### Non-React subscription

```ts
const sub = queryAtom.onQueryChange(["users"], (next, prev) => {
  // Fires on create (prev === undefined), update, and destroy (next === undefined).
});
sub.unsubscribe();
```

## How invalidation matches keys

Cache keys are hashed via canonical JSON serialization with sorted object keys. Two consequences:

- `["users", { role: "admin", active: true }]` and `["users", { active: true, role: "admin" }]` hash to the **same** entry.
- `["users", "1|2"]` and `["users", 1, 2]` hash to **different** entries (the old pipe-joined hash collided here).

Partial invalidation matches at JSON-array boundaries: `["users", 1]` matches `["users", 1, "profile"]` because the child extends past the prefix's closing bracket. It does not match `["users", 10]` because `10` is a different complete element.

## Migrating from TanStack Query

A rough mental mapping:

| TanStack Query | atomic-query |
|---|---|
| `useQuery({ queryKey, queryFn })` | `queryAtom.useQuery({ queryKey, queryFn })` |
| `useMutation({ mutationFn, onSuccess, ... })` | `useMutation({ mutationFn, onSuccess, ... })` |
| `queryClient.invalidateQueries({ queryKey })` | `queryAtom.invalidate({ queryKey })` |
| `queryClient.setQueryData(key, updater)` | `queryAtom.updateQueryData(key, updater)` |
| `queryClient.prefetchQuery(...)` | Fetch in your framework loader + `seedQuery(...)` |
| `<HydrationBoundary state={dehydrate(client)}>` | `<HydrateQueries entries={[...]}>` |
| `useSuspenseQuery` | Move the suspense boundary into the framework loader |
| `useInfiniteQuery` | Not yet shipped — use `queryAtom.push(...)` on an existing list query |

## What's NOT here (yet)

- **Suspense-mode `useSuspenseQuery`.** Streaming Suspense lives in the framework loader; the cache only handles client-side reads.
- **Infinite queries with `getNextPageParam`.** For now, model paginated lists as an array query and use `queryAtom.push(...)` to append.
- **Persistent cache adapters** (localStorage/IndexedDB). Use `@mongez/cache` directly for ad-hoc persistence; a `persist: true` option may land on atom in a future minor.

## Name

Yes — `@mongez/atomic-query`. The name pairs with `@mongez/atom`. If you're parsing it as "atomic + query," that's not quite the right reading; it's "atom-shaped query cache." Either reading is fine.

## License

MIT
