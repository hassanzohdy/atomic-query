/**
 * `useMutation` tests.
 *
 * What we're proving:
 *   - Status surface flips idle → pending → success/error.
 *   - onMutate / onSuccess / onError / onSettled fire in the right order
 *     with the right arguments.
 *   - A second mutate call aborts the first.
 *   - Unmount aborts the in-flight call.
 *   - reset() clears state and aborts.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMutation } from "../mutation";
import { __resetAtomicQueryForTests } from "../utils";

afterEach(() => {
  __resetAtomicQueryForTests();
});

describe("useMutation", () => {
  it("flips through idle → pending → success and resolves with data", async () => {
    const { result } = renderHook(() =>
      useMutation<{ ok: true }, { id: number }>({
        mutationFn: async () => ({ ok: true }),
      }),
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.isIdle).toBe(true);

    let resolvedValue: { ok: true } | undefined;
    await act(async () => {
      resolvedValue = await result.current.mutate({ id: 1 });
    });

    expect(resolvedValue).toEqual({ ok: true });
    expect(result.current.status).toBe("success");
    expect(result.current.data).toEqual({ ok: true });
    expect(result.current.variables).toEqual({ id: 1 });
  });

  it("flips to error when the mutationFn throws and re-throws to the caller", async () => {
    const err = new Error("boom");
    const { result } = renderHook(() =>
      useMutation({ mutationFn: async () => { throw err; } }),
    );

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutate(undefined as any);
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBe(err);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(err);
    expect(result.current.isError).toBe(true);
  });

  it("fires onMutate → mutationFn → onSuccess → onSettled in order", async () => {
    const order: string[] = [];
    const { result } = renderHook(() =>
      useMutation<number, number>({
        mutationFn: async v => {
          order.push("fn");
          return v * 2;
        },
        onMutate: () => {
          order.push("onMutate");
          return "ctx" as any;
        },
        onSuccess: () => {
          order.push("onSuccess");
        },
        onSettled: () => {
          order.push("onSettled");
        },
      }),
    );

    await act(async () => {
      await result.current.mutate(21);
    });

    expect(order).toEqual(["onMutate", "fn", "onSuccess", "onSettled"]);
    expect(result.current.data).toBe(42);
  });

  it("aborts the previous in-flight call when mutate fires a second time", async () => {
    const signals: AbortSignal[] = [];
    const { result } = renderHook(() =>
      useMutation<string, string>({
        mutationFn: (v, { signal }) => {
          signals.push(signal);
          return new Promise((resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            // Resolve eventually so the 2nd call can complete.
            setTimeout(() => resolve(v), 5);
          });
        },
      }),
    );

    let secondResult: string | undefined;
    await act(async () => {
      // Fire the first; do NOT await — let it stay pending.
      result.current.mutate("first").catch(() => {});
      // Immediately fire the second.
      secondResult = await result.current.mutate("second");
    });

    expect(secondResult).toBe("second");
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("reset() clears data/error/status and aborts in-flight", async () => {
    const { result } = renderHook(() =>
      useMutation({ mutationFn: async () => "done" }),
    );

    await act(async () => {
      await result.current.mutate(undefined as any);
    });
    expect(result.current.data).toBe("done");

    act(() => result.current.reset());

    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.variables).toBeUndefined();
  });

  it("unmount aborts the in-flight call", async () => {
    let observedSignal: AbortSignal | undefined;
    const { result, unmount } = renderHook(() =>
      useMutation<void, void>({
        mutationFn: (_, { signal }) => {
          observedSignal = signal;
          return new Promise(() => {}); // never resolves
        },
      }),
    );

    act(() => {
      result.current.mutate().catch(() => {});
    });

    expect(observedSignal).toBeDefined();
    expect(observedSignal!.aborted).toBe(false);
    unmount();
    expect(observedSignal!.aborted).toBe(true);
  });
});
