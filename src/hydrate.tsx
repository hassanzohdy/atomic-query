"use client";
/**
 * @fileoverview SSR-integration helper: a React component that seeds the
 * cache with data fetched by your framework's loader.
 *
 * atomic-query is a client-side cache. For initial render data, your
 * framework already has the right tool — Next.js server components,
 * Remix `loader`, TanStack Start `loader`. This component is the seam:
 * pass loader-fetched data into the cache so `useQuery` consumers down
 * the tree skip the on-mount refetch.
 *
 * @example Next.js App Router
 * ```tsx
 * // server component
 * export default async function Page() {
 *   const users = await db.users.findMany();
 *   return (
 *     <HydrateQueries entries={[{ queryKey: ["users"], data: users }]}>
 *       <UserListClient />
 *     </HydrateQueries>
 *   );
 * }
 * ```
 *
 * @example Remix / TanStack Start
 * ```tsx
 * export async function loader() {
 *   return json({ users: await db.users.findMany() });
 * }
 * export default function UsersRoute() {
 *   const { users } = useLoaderData<typeof loader>();
 *   return (
 *     <HydrateQueries entries={[{ queryKey: ["users"], data: users }]}>
 *       <UserListClient />
 *     </HydrateQueries>
 *   );
 * }
 * ```
 */
import React, { useMemo } from "react";
import { queryAtom } from "./query-atom";
import type { SeedEntry } from "./types";

export type HydrateQueriesProps = {
  /**
   * Cache entries to seed. Each entry's `queryKey` will receive the
   * given `data`, and consumers using that key will see the value
   * immediately on first render — no flash, no refetch — as long as the
   * data is still fresh per `freshFor` / `staleTime`.
   */
  entries: SeedEntry[];
  children: React.ReactNode;
};

/**
 * Seed the atomic-query cache from a framework loader.
 *
 * The seed runs synchronously during render (not in an effect) so that
 * `useQuery` consumers rendered as children read the seeded data on
 * their FIRST render. That's safe because `seedQuery` only writes to
 * the atom — it doesn't subscribe to React state and doesn't trigger
 * effects.
 *
 * The `useMemo` wrapper is a guard against re-running the seed when
 * `entries` is a new reference but the same content (the common case
 * when a parent re-renders with the same loader data).
 */
export function HydrateQueries({ entries, children }: HydrateQueriesProps) {
  useMemo(() => {
    for (const entry of entries) {
      queryAtom.seedQuery(entry);
    }
    // Re-seed when the structural identity of `entries` changes. We
    // compare by hashing the keys; identity equality on the array is
    // not stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(entries.map(e => e.queryKey))]);

  return <>{children}</>;
}
