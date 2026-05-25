/**
 * React-hook tests for `useQuery` and friends.
 *
 * Specifically targeted regressions:
 *   - B4: two simultaneous `useQuery` mounts for the same key should
 *         result in ONE `queryFn` invocation, not two.
 *   - B5/B6/B7: hooks use `useSyncExternalStore` and don't mutate state
 *         during render. Strict Mode double-renders should not produce
 *         duplicate queries or duplicate fetches.
 *   - B8: re-render with a NEW `queryFn` closure → a manual refetch
 *         runs the new closure, not the original.
 *   - General useQuery flow: loading → success.
 */
import { act, render, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HydrateQueries } from "../hydrate";
import { queryAtom } from "../query-atom";
import { __resetAtomicQueryForTests } from "../utils";

afterEach(() => {
  __resetAtomicQueryForTests();
});

describe("useQuery — basic flow", () => {
  it("starts with isLoading=true and resolves with data", async () => {
    const queryFn = vi.fn().mockResolvedValue([{ id: 1, name: "Alice" }]);
    const { result } = renderHook(() =>
      queryAtom.useQuery({ queryKey: ["users"], queryFn }),
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([{ id: 1, name: "Alice" }]);
    expect(result.current.state).toBe("success");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("two simultaneous consumers share ONE fetch (B4 promise dedup)", async () => {
    const queryFn = vi.fn().mockResolvedValue("once");

    function Both() {
      const a = queryAtom.useQuery({ queryKey: ["dedup"], queryFn });
      const b = queryAtom.useQuery({ queryKey: ["dedup"], queryFn });
      // void-touch so the hook return isn't tree-shaken.
      return (
        <div>
          {String(a.isLoading)}-{String(b.isLoading)}
        </div>
      );
    }

    render(<Both />);
    await waitFor(() => {
      expect(queryAtom.getQuery(["dedup"])?.state).toBe("success");
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe("useQuery — Strict Mode (B5/B6)", () => {
  it("creates the query exactly once under <StrictMode>", async () => {
    const queryFn = vi.fn().mockResolvedValue([1, 2, 3]);
    render(
      <React.StrictMode>
        <StrictModeChild queryFn={queryFn} />
      </React.StrictMode>,
    );
    await waitFor(() => {
      expect(queryAtom.getQuery(["strict"])?.state).toBe("success");
    });
    // Strict Mode mounts/unmounts/remounts in dev. The "ensure query"
    // effect can run twice, but the deduped queryFn must only run once
    // per actual data refresh. With one mount and no key change, that's
    // exactly one call.
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
function StrictModeChild({ queryFn }: { queryFn: () => Promise<unknown> }) {
  queryAtom.useQuery({ queryKey: ["strict"], queryFn });
  return null;
}

describe("useQuery — queryFn freshness (B8)", () => {
  it("refetch picks up the latest queryFn closure, not the first", async () => {
    let calls = 0;
    function Component({ tick }: { tick: number }) {
      // A new closure each render that captures the current `tick`.
      queryAtom.useQuery({
        queryKey: ["fresh"],
        queryFn: async () => {
          calls++;
          return tick;
        },
      });
      return null;
    }

    const { rerender } = render(<Component tick={1} />);
    await waitFor(() => {
      expect(queryAtom.getQuery(["fresh"])?.data).toBe(1);
    });

    // Re-render with a different tick → triggers a different closure.
    rerender(<Component tick={2} />);

    // No new fetch yet (data is fresh). Force one via refetchQuery —
    // it should pick up the LATEST closure and produce 2, not 1.
    await act(async () => {
      await queryAtom.refetchQuery(["fresh"]);
    });

    expect(queryAtom.getQuery(["fresh"])?.data).toBe(2);
    expect(calls).toBe(2);
  });
});

describe("useQuery — error path", () => {
  it("flips isError when the fetcher throws and stops retrying when retry: 0", async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error("boom"));
    renderHook(() =>
      queryAtom.useQuery({ queryKey: ["err"], queryFn, retry: 0 }),
    );

    await waitFor(() => {
      expect(queryAtom.getQuery(["err"])?.isError).toBe(true);
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryAtom.getQuery(["err"])?.error).toBeInstanceOf(Error);
  });
});

describe("<HydrateQueries> — framework loader integration", () => {
  it("seeds the cache so useQuery sees the data on first render", async () => {
    const queryFn = vi.fn(); // should NEVER be called for fresh seeds
    function Reader() {
      const q = queryAtom.useQuery({
        queryKey: ["users"],
        queryFn,
        staleTime: 60_000, // keep the seeded data fresh
      });
      return <span data-testid="name">{q.data?.[0]?.name ?? "(loading)"}</span>;
    }

    const { getByTestId } = render(
      <HydrateQueries
        entries={[
          { queryKey: ["users"], data: [{ id: 1, name: "Alice" }] },
        ]}>
        <Reader />
      </HydrateQueries>,
    );

    // First paint already shows the seeded value — no spinner flash.
    expect(getByTestId("name").textContent).toBe("Alice");
    // And the queryFn is not invoked because the data isn't stale.
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe("useQuery — destroyQuery aborts in-flight", () => {
  it("aborts the controller passed to queryFn when the query is destroyed", async () => {
    let observedSignal: AbortSignal | null = null;
    const queryFn = vi.fn().mockImplementation(({ signal }) => {
      observedSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    renderHook(() =>
      queryAtom.useQuery({ queryKey: ["abortable"], queryFn }),
    );

    await waitFor(() => expect(observedSignal).not.toBeNull());

    act(() => {
      queryAtom.destroyQuery(["abortable"]);
    });

    expect(observedSignal!.aborted).toBe(true);
  });
});
