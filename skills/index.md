---
description: >-
  Use @mongez/atomic-query to keep client-side server data in a React cache:
  read it with queryAtom.useQuery, write through useMutation, then update or
  invalidate affected query keys. Start with a stable array key, pass the
  supplied AbortSignal into the request, and render the loading, error, and
  data states. Use the focused topics for cache lifecycle, list helpers,
  pagination, Suspense, and loader-to-client hydration; this package is
  client-only and deliberately leaves HTTP transport and server loading to
  your application or its framework.
---

# @mongez/atomic-query

## Common path: fetch, mutate, and refresh a list

Use this path for most screens that display server data and let the user
change it. Keep each query key stable and structured, propagate the provided
`signal` to the request, then either make an immediate cache update or
invalidate the affected key after a mutation.

```tsx
"use client";

import { queryAtom, useMutation } from "@mongez/atomic-query";

function Todos() {
  const todos = queryAtom.useQuery<Todo[]>({
    queryKey: ["todos"],
    queryFn: ({ signal }) =>
      fetch("/api/todos", { signal }).then(response => response.json()),
    staleTime: 30_000,
  });

  const createTodo = useMutation<Todo, { title: string }>({
    mutationFn: (input, { signal }) =>
      fetch("/api/todos", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      }).then(response => response.json()),
    onSuccess: todo => queryAtom.push(["todos"], todo),
    onSettled: () => queryAtom.invalidate({ queryKey: ["todos", "stats"] }),
  });

  if (todos.isLoading) return <p>Loading…</p>;
  if (todos.error) return <p>Could not load todos.</p>;

  return (
    <>
      <button onClick={() => createTodo.mutate({ title: "New todo" })}>
        Add todo
      </button>
      <ul>{todos.data?.map(todo => <li key={todo.id}>{todo.title}</li>)}</ul>
    </>
  );
}
```

Use `isLoading` for the first request and `isFetching` for a later refresh.
For mutations where the server response is not enough to update every affected
view, call `invalidate({ queryKey })`; prefix matching refreshes descendant
keys too.

## Query and cache fundamentals

- [Overview](./overview/SKILL.md) — package boundaries and its query, mutation, hydration, and Suspense surfaces.
- [Queries](./queries/SKILL.md) — `useQuery` options, result state, retries, subscriptions, keys, and cancellation.
- [Basic queries](./basic-query/SKILL.md) — a practical `useQuery` walkthrough and granular field hooks.
- [Cache management](./cache/SKILL.md) — direct reads, writes, seeding, destruction, garbage collection, and subscriptions.
- [Invalidation](./invalidation/SKILL.md) — exact/prefix invalidation, manual refetching, and post-write refresh patterns.

## Writes and collections

- [Mutations](./mutations/SKILL.md) — `useMutation`, callback order, optimistic updates, rollback, and aborting writes.
- [List helpers](./list-helpers/SKILL.md) — immutable `push`, `remove`, `replace`, sorting, and other cached-array updates.
- [List queries](./list-queries/SKILL.md) — applying list helpers and pagination to query data.
- [Recipes](./recipes/SKILL.md) — composed optimistic, prefetch, feed, invalidation, and detail-page patterns.

## Pagination and rendering modes

- [Infinite queries](./infinite/SKILL.md) — cursor or offset pagination with `useInfiniteQuery` and `fetchNextPage`.
- [Suspense](./suspense/SKILL.md) — `useSuspenseQuery`, `<Suspense>`, and `ErrorBoundary` placement.
- [SSR hydration](./ssr/SKILL.md) — seed the client cache from framework-loaded data with `<HydrateQueries>`.

## Not this package →

- Need to make HTTP requests, configure interceptors, or handle transport errors? Use `@mongez/http`.
- Need server rendering, loaders, routing, or framework streaming? Use your React framework; this package is client-only.
- Need local UI state that is not server-backed data? Use `@mongez/react-atom`.
