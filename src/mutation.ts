"use client";
/**
 * @fileoverview `useMutation` — the mutation counterpart to `useQuery`.
 *
 * Mutations are write-side operations (POST/PUT/PATCH/DELETE etc.) that
 * don't fit the `useQuery` model because they're imperative: the
 * component fires them in response to user input, not on mount, and
 * needs callbacks for success / error / settled.
 *
 * Design notes:
 *
 * - The hook keeps its own local state (loading/error/data); it does NOT
 *   write to the `queryAtom` cache. Mutations don't have a stable
 *   "key" in the cache sense — they fire ad-hoc and produce one-shot
 *   results.
 * - Cache interaction is the caller's job in callbacks: invalidate
 *   queries, optimistically `updateQueryData`, etc. The hook gives you
 *   `invalidate` / `updateQueryData` via the imported `queryAtom`.
 * - Aborting: a `signal` is passed to `mutationFn`. The hook aborts when
 *   it unmounts mid-flight; the caller can also abort manually via the
 *   returned `reset()`.
 * - This is a thin hook; it deliberately doesn't grow into the full
 *   TanStack Query mutation surface (mutationKey caching, optimistic
 *   rollback machinery, retries). When you need those, build them on top
 *   of this primitive.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type MutationStatus = "idle" | "pending" | "error" | "success";

export type UseMutationOptions<TData, TVariables, TContext = unknown> = {
  /** The side-effect to run. Receives the variables and an abort signal. */
  mutationFn: (
    variables: TVariables,
    ctx: { signal: AbortSignal },
  ) => Promise<TData>;
  /**
   * Optional optimistic-update hook. Runs BEFORE the mutation fires.
   * Whatever you return here is passed to `onError` so you can roll back.
   */
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  /** Called after a successful mutation. */
  onSuccess?: (
    data: TData,
    variables: TVariables,
    context: TContext | undefined,
  ) => void | Promise<void>;
  /** Called when the mutation throws. Use `context` to roll back optimistic state. */
  onError?: (
    error: unknown,
    variables: TVariables,
    context: TContext | undefined,
  ) => void | Promise<void>;
  /** Called after success or error. Useful for cleanup or invalidations. */
  onSettled?: (
    data: TData | undefined,
    error: unknown,
    variables: TVariables,
    context: TContext | undefined,
  ) => void | Promise<void>;
};

export type UseMutationResult<TData, TVariables> = {
  /** Fire the mutation and resolve with its data. */
  mutate: (variables: TVariables) => Promise<TData>;
  /** Same as `mutate` but discards the returned promise (fire-and-forget). */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  /** Clear state and abort any in-flight call. */
  reset: () => void;
  data: TData | undefined;
  error: unknown;
  variables: TVariables | undefined;
  status: MutationStatus;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isIdle: boolean;
};

/**
 * Imperative side-effect hook with success / error / settled callbacks
 * and a status surface for inline UI.
 *
 * @example
 * ```tsx
 * const createUser = useMutation({
 *   mutationFn: ({ name }) =>
 *     fetch("/api/users", { method: "POST", body: JSON.stringify({ name }) })
 *       .then(r => r.json()),
 *   onSuccess: user => {
 *     queryAtom.updateQueryData<User[]>(["users"], old => [...(old ?? []), user]);
 *     queryAtom.invalidate({ queryKey: ["users", "stats"] });
 *   },
 * });
 *
 * <button
 *   disabled={createUser.isPending}
 *   onClick={() => createUser.mutate({ name: "Alice" })}>
 *   {createUser.isPending ? "Creating…" : "Create"}
 * </button>
 * ```
 */
export function useMutation<
  TData = unknown,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TVariables, TContext>,
): UseMutationResult<TData, TVariables> {
  // Keep callback refs fresh so `mutate` always sees the latest closures
  // without needing to re-create the function each render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [data, setData] = useState<TData | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [variables, setVariables] = useState<TVariables | undefined>(undefined);
  const [status, setStatus] = useState<MutationStatus>("idle");

  // Abort controller for the in-flight call. New mutate replaces it;
  // unmount aborts the last one.
  const controllerRef = useRef<AbortController | null>(null);
  // Track mount status so post-resolve setState doesn't trigger
  // "set state on unmounted component" warnings.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (!mountedRef.current) return;
    setData(undefined);
    setError(undefined);
    setVariables(undefined);
    setStatus("idle");
  }, []);

  const mutate = useCallback(
    async (vars: TVariables): Promise<TData> => {
      // Abort previous in-flight before starting a new one.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      if (mountedRef.current) {
        setVariables(vars);
        setStatus("pending");
        setError(undefined);
      }

      let context: TContext | undefined;
      try {
        if (optionsRef.current.onMutate) {
          context = await optionsRef.current.onMutate(vars);
        }
        const result = await optionsRef.current.mutationFn(vars, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          // Drop the result; a newer mutate or unmount cancelled us.
          throw new DOMException("Mutation aborted", "AbortError");
        }
        if (mountedRef.current) {
          setData(result);
          setStatus("success");
        }
        await optionsRef.current.onSuccess?.(result, vars, context);
        await optionsRef.current.onSettled?.(result, null, vars, context);
        return result;
      } catch (err) {
        if (mountedRef.current && !controller.signal.aborted) {
          setError(err);
          setStatus("error");
        }
        if (!controller.signal.aborted) {
          await optionsRef.current.onError?.(err, vars, context);
          await optionsRef.current.onSettled?.(undefined, err, vars, context);
        }
        throw err;
      } finally {
        // Only clear if this controller is still the current one (a
        // newer mutate could have replaced it before we resolved).
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [],
  );

  return {
    mutate,
    // `mutateAsync` is just a friendlier name — same semantics.
    mutateAsync: mutate,
    reset,
    data,
    error,
    variables,
    status,
    isPending: status === "pending",
    isError: status === "error",
    isSuccess: status === "success",
    isIdle: status === "idle",
  };
}
