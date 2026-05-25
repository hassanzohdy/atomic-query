"use client";
/**
 * @fileoverview Array-shaped mutation helpers for list queries.
 *
 * These mirror `atomCollection`'s API. They all delegate to
 * `updateQueryData` so any mutation flows through the same code path
 * (immutable updater, single atom write, single subscriber wakeup).
 *
 * Each helper is a no-op when the named query holds `undefined` (the
 * query hasn't loaded yet) — that's the safer behavior than crashing
 * on `undefined.filter`, and it lets callers fire optimistic mutations
 * without first checking that the query has resolved.
 */
import { queryAtom } from "./query-atom";
import type { QueryKey } from "./types";

function ensureArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Append items to the end of a list query. */
export function push(queryKey: QueryKey, data: any): void {
  queryAtom.updateQueryData(queryKey, old => [...ensureArray(old as any[]), data]);
}

/** Prepend items to the beginning of a list query. */
export function unshift(queryKey: QueryKey, data: any): void {
  queryAtom.updateQueryData(queryKey, old => [data, ...ensureArray(old as any[])]);
}

/** Drop the last item. */
export function pop(queryKey: QueryKey): void {
  queryAtom.updateQueryData(queryKey, old => ensureArray(old as any[]).slice(0, -1));
}

/** Drop the first item. */
export function shift(queryKey: QueryKey): void {
  queryAtom.updateQueryData(queryKey, old => ensureArray(old as any[]).slice(1));
}

/** Replace the item at `index`. */
export function replace(queryKey: QueryKey, index: number, data: any): void {
  queryAtom.updateQueryData(queryKey, old => {
    const arr = ensureArray(old as any[]);
    const next = arr.slice();
    next[index] = data;
    return next;
  });
}

/** Remove the item at `index`. */
export function removeByIndex(queryKey: QueryKey, index: number): void {
  queryAtom.updateQueryData(queryKey, old => {
    const arr = ensureArray(old as any[]);
    const next = arr.slice();
    next.splice(index, 1);
    return next;
  });
}

/**
 * Remove every occurrence of `item` (strict equality).
 *
 * NB: this is a value-equality remove; for object items use
 * {@link removeByIndex} with the result of a `findIndex` call.
 */
export function remove(queryKey: QueryKey, item: any): void {
  queryAtom.updateQueryData(queryKey, old => {
    const arr = ensureArray(old as any[]);
    return arr.filter(i => i !== item);
  });
}

/** Empty the list. */
export function clear(queryKey: QueryKey): void {
  queryAtom.updateQueryData(queryKey, () => []);
}

/** Sort in place (well — sort into a new array, then commit). */
export function sort(
  queryKey: QueryKey,
  compareFn: (a: any, b: any) => number,
): void {
  queryAtom.updateQueryData(queryKey, old => {
    const arr = ensureArray(old as any[]);
    return arr.slice().sort(compareFn);
  });
}

/** Reverse the order. */
export function reverse(queryKey: QueryKey): void {
  queryAtom.updateQueryData(queryKey, old => {
    const arr = ensureArray(old as any[]);
    return arr.slice().reverse();
  });
}
