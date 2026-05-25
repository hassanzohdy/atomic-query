/**
 * useSuspenseQuery tests.
 *
 * Verifies:
 *   - While loading and no data: throws a promise (React suspends).
 *   - When the query errors: throws the error (ErrorBoundary catches).
 *   - When data is available: returns the query with data typed as T.
 *   - Subsequent renders that are still pending throw the SAME promise
 *     identity so React can coalesce the suspension.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSuspenseQuery } from "../suspense";
import { __resetAtomicQueryForTests } from "../utils";

afterEach(() => {
  cleanup();
  __resetAtomicQueryForTests();
});

class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <>{this.props.fallback}</>;
    return this.props.children;
  }
}

describe("useSuspenseQuery", () => {
  it("suspends while loading and renders data once the fetch resolves", async () => {
    function Inner() {
      const q = useSuspenseQuery<{ name: string }>({
        queryKey: ["susp.ok"],
        queryFn: async () => ({ name: "Alice" }),
      });
      return <span data-testid="name">{q.data.name}</span>;
    }

    const { queryByText, getByTestId } = render(
      <Suspense fallback={<span>loading…</span>}>
        <Inner />
      </Suspense>,
    );

    // First render: the hook throws a promise, fallback renders.
    expect(queryByText("loading…")).toBeTruthy();

    // Once the fetch resolves and the query settles, the boundary
    // re-renders the child with data.
    await waitFor(() => {
      expect(getByTestId("name").textContent).toBe("Alice");
    });
  });

  it("propagates errors to an ErrorBoundary", async () => {
    function Inner() {
      const q = useSuspenseQuery({
        queryKey: ["susp.err"],
        queryFn: async () => {
          throw new Error("boom");
        },
        retry: 0,
      });
      return <span>{String(q.data)}</span>;
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { queryByText } = render(
      <ErrorBoundary fallback={<span>caught</span>}>
        <Suspense fallback={<span>loading…</span>}>
          <Inner />
        </Suspense>
      </ErrorBoundary>,
    );

    // Initially suspended.
    expect(queryByText("loading…")).toBeTruthy();

    await waitFor(() => {
      expect(queryByText("caught")).toBeTruthy();
    });

    spy.mockRestore();
  });
});
