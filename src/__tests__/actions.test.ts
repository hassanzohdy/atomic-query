/**
 * Imperative API tests for the actions exposed on `queryAtom` and
 * re-exported from the package barrel.
 *
 * Three classes of regressions guarded here:
 *
 *   - B1: clearCache / getCacheStats / garbageCollect / limitCacheSize /
 *         setupAutoGC used to call themselves and stack-overflow. We
 *         now invoke each via the atom to prove it does the work.
 *   - B2: invalidate is segment-aware (parametric tests live in
 *         hash.test.ts; this file proves the live cache reacts
 *         correctly).
 *   - General: seedQuery / destroyQuery / updateQueryData / array
 *     helpers behave on the cache value itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryAtom } from "../query-atom";
import { __resetAtomicQueryForTests } from "../utils";

afterEach(() => {
  __resetAtomicQueryForTests();
});

describe("self-recursion regression (B1)", () => {
  it("clearCache() doesn't stack-overflow", () => {
    expect(() => queryAtom.clearCache()).not.toThrow();
    expect(queryAtom.getCacheStats().totalQueries).toBe(0);
  });

  it("getCacheStats() returns a real object", () => {
    const stats = queryAtom.getCacheStats();
    expect(stats).toMatchObject({
      totalQueries: 0,
      loadingQueries: 0,
      errorQueries: 0,
      successfulQueries: 0,
    });
  });

  it("garbageCollect() returns a number", () => {
    expect(typeof queryAtom.garbageCollect(0)).toBe("number");
  });

  it("limitCacheSize() returns a number", () => {
    expect(typeof queryAtom.limitCacheSize(10)).toBe("number");
  });

  it("setupAutoGC() returns a stop function", () => {
    const stop = queryAtom.setupAutoGC();
    expect(typeof stop).toBe("function");
    stop();
  });
});

describe("seedQuery", () => {
  it("inserts a successful query the cache can read immediately", () => {
    queryAtom.seedQuery({
      queryKey: ["users"],
      data: [{ id: 1, name: "Alice" }],
    });
    const q = queryAtom.getQuery(["users"]);
    expect(q?.data).toEqual([{ id: 1, name: "Alice" }]);
    expect(q?.state).toBe("success");
    expect(q?.isLoading).toBe(false);
  });

  it("overwrites existing data while preserving createdAt", () => {
    queryAtom.seedQuery({ queryKey: ["users"], data: [{ id: 1 }] });
    const firstCreatedAt = queryAtom.getQuery(["users"])!.createdAt;

    queryAtom.seedQuery({ queryKey: ["users"], data: [{ id: 2 }] });
    expect(queryAtom.getQuery(["users"])?.data).toEqual([{ id: 2 }]);
    expect(queryAtom.getQuery(["users"])?.createdAt).toBe(firstCreatedAt);
  });
});

describe("invalidate — segment-aware matching", () => {
  it("matches child queries but not numeric siblings", async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    // Seed three queries via the cache directly so we don't need React.
    queryAtom.seedQuery({ queryKey: ["users", 1], data: { id: 1 } });
    queryAtom.seedQuery({ queryKey: ["users", 1, "profile"], data: {} });
    queryAtom.seedQuery({ queryKey: ["users", 10], data: { id: 10 } });

    // Replace queryFn on each so invalidate has something to call.
    for (const key of Object.keys(queryAtom.get("queries"))) {
      const q = queryAtom.get("queries")[key];
      queryAtom.updateQueryData(q.queryKey, () => q.data);
      // Rewrite queryFn directly to track calls.
      queryAtom.get("queries")[key].queryFn = queryFn as any;
    }

    await queryAtom.invalidate({ queryKey: ["users", 1] });

    // queryFn should have run for `["users", 1]` and `["users", 1, "profile"]`
    // but NOT for `["users", 10]`. Two calls total.
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("exact: true only refetches the exact match", async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    queryAtom.seedQuery({ queryKey: ["users", 1], data: { id: 1 } });
    queryAtom.seedQuery({ queryKey: ["users", 1, "profile"], data: {} });

    for (const key of Object.keys(queryAtom.get("queries"))) {
      queryAtom.get("queries")[key].queryFn = queryFn as any;
    }

    await queryAtom.invalidate({ queryKey: ["users", 1], exact: true });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe("updateQueryData", () => {
  it("replaces data via an updater and leaves other state intact", () => {
    queryAtom.seedQuery({ queryKey: ["users"], data: [1, 2, 3] });
    const before = queryAtom.getQuery(["users"]);
    queryAtom.updateQueryData<number[]>(["users"], old => [...(old ?? []), 4]);
    const after = queryAtom.getQuery(["users"]);
    expect(after?.data).toEqual([1, 2, 3, 4]);
    expect(after?.state).toBe(before?.state);
  });

  it("is a no-op when the query is not in the cache", () => {
    expect(() =>
      queryAtom.updateQueryData(["nothing"], () => [1]),
    ).not.toThrow();
    expect(queryAtom.getQuery(["nothing"])).toBeUndefined();
  });
});

describe("destroyQuery", () => {
  it("removes the entry from the cache", () => {
    queryAtom.seedQuery({ queryKey: ["users"], data: [] });
    expect(queryAtom.getQuery(["users"])).toBeDefined();
    queryAtom.destroyQuery(["users"]);
    expect(queryAtom.getQuery(["users"])).toBeUndefined();
  });

  it("is a no-op for unknown keys", () => {
    expect(() => queryAtom.destroyQuery(["does-not-exist"])).not.toThrow();
  });
});

describe("array manipulation helpers", () => {
  it("push / unshift / pop / shift", () => {
    queryAtom.seedQuery({ queryKey: ["list"], data: [2, 3] });
    queryAtom.push(["list"], 4);
    queryAtom.unshift(["list"], 1);
    expect(queryAtom.getData(["list"])).toEqual([1, 2, 3, 4]);
    queryAtom.pop(["list"]);
    queryAtom.shift(["list"]);
    expect(queryAtom.getData(["list"])).toEqual([2, 3]);
  });

  it("replace / removeByIndex / remove / clear", () => {
    queryAtom.seedQuery({ queryKey: ["list"], data: [1, 2, 3, 2] });
    queryAtom.replace(["list"], 0, 99);
    expect(queryAtom.getData(["list"])).toEqual([99, 2, 3, 2]);
    queryAtom.removeByIndex(["list"], 2);
    expect(queryAtom.getData(["list"])).toEqual([99, 2, 2]);
    queryAtom.remove(["list"], 2);
    expect(queryAtom.getData(["list"])).toEqual([99]);
    queryAtom.clear(["list"]);
    expect(queryAtom.getData(["list"])).toEqual([]);
  });

  it("sort / reverse", () => {
    queryAtom.seedQuery({ queryKey: ["list"], data: [3, 1, 2] });
    queryAtom.sort(["list"], (a, b) => a - b);
    expect(queryAtom.getData(["list"])).toEqual([1, 2, 3]);
    queryAtom.reverse(["list"]);
    expect(queryAtom.getData(["list"])).toEqual([3, 2, 1]);
  });

  it("gracefully handles a query whose data is not yet an array", () => {
    queryAtom.seedQuery({ queryKey: ["list"], data: undefined as any });
    expect(() => queryAtom.push(["list"], 1)).not.toThrow();
    expect(queryAtom.getData(["list"])).toEqual([1]);
  });
});

describe("onQueryChange — fires for create AND destroy (B13)", () => {
  it("fires when the query is first seeded", async () => {
    const cb = vi.fn();
    queryAtom.onQueryChange(["users"], cb);
    queryAtom.seedQuery({ queryKey: ["users"], data: [] });
    expect(cb).toHaveBeenCalledTimes(1);
    const [next, prev] = cb.mock.calls[0];
    expect(prev).toBeUndefined();
    expect(next?.data).toEqual([]);
  });

  it("fires when the query is destroyed", () => {
    queryAtom.seedQuery({ queryKey: ["users"], data: [] });
    const cb = vi.fn();
    queryAtom.onQueryChange(["users"], cb);
    queryAtom.destroyQuery(["users"]);
    expect(cb).toHaveBeenCalledTimes(1);
    const [next, prev] = cb.mock.calls[0];
    expect(next).toBeUndefined();
    expect(prev?.data).toEqual([]);
  });
});
