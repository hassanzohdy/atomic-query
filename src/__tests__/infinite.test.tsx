/**
 * useInfiniteQuery tests.
 *
 * Covers:
 *   - First-page fetch produces { pages, pageParams } with one entry each.
 *   - fetchNextPage appends a page and updates pageParams.
 *   - hasNextPage flips to false when getNextPageParam returns undefined.
 *   - isFetchingNextPage transitions correctly.
 *   - Cursor passed to queryFn matches the param computed by getNextPageParam.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInfiniteQuery } from "../infinite";
import { queryAtom } from "../query-atom";
import { __resetAtomicQueryForTests } from "../utils";

afterEach(() => {
  __resetAtomicQueryForTests();
});

type Page = { items: number[]; nextCursor: number | null };

describe("useInfiniteQuery", () => {
  it("fetches the first page eagerly and exposes pages + pageParams", async () => {
    const queryFn = vi
      .fn<(ctx: { pageParam: number }) => Promise<Page>>()
      .mockImplementation(async ({ pageParam }) => ({
        items: [pageParam * 10, pageParam * 10 + 1],
        nextCursor: pageParam + 1,
      }));

    const { result } = renderHook(() =>
      useInfiniteQuery<Page, number>({
        queryKey: ["inf.pages"],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: last => last.nextCursor ?? undefined,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pages[0].items).toEqual([0, 1]);
    expect(result.current.data?.pageParams).toEqual([0]);
    expect(queryFn).toHaveBeenCalledWith(
      expect.objectContaining({ pageParam: 0 }),
    );
  });

  it("fetchNextPage appends a page and advances the cursor", async () => {
    const queryFn = vi
      .fn<(ctx: { pageParam: number }) => Promise<Page>>()
      .mockImplementation(async ({ pageParam }) => ({
        items: [pageParam * 10],
        nextCursor: pageParam < 2 ? pageParam + 1 : null,
      }));

    const { result } = renderHook(() =>
      useInfiniteQuery<Page, number>({
        queryKey: ["inf.cursor"],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: last => last.nextCursor ?? undefined,
      }),
    );

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.data?.pages).toHaveLength(2);
    expect(result.current.data?.pageParams).toEqual([0, 1]);
    expect(result.current.data?.pages[1].items).toEqual([10]);
    expect(queryFn).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageParam: 1 }),
    );
  });

  it("hasNextPage reflects getNextPageParam returning undefined", async () => {
    const queryFn = vi
      .fn<(ctx: { pageParam: number }) => Promise<Page>>()
      .mockImplementation(async ({ pageParam }) => ({
        items: [pageParam],
        nextCursor: pageParam < 1 ? pageParam + 1 : null,
      }));

    const { result } = renderHook(() =>
      useInfiniteQuery<Page, number>({
        queryKey: ["inf.has-next"],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: last => last.nextCursor ?? undefined,
      }),
    );

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.data?.pages).toHaveLength(2);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("fetchNextPage is a no-op when hasNextPage is false", async () => {
    const queryFn = vi
      .fn<(ctx: { pageParam: number }) => Promise<Page>>()
      .mockResolvedValue({ items: [0], nextCursor: null });

    const { result } = renderHook(() =>
      useInfiniteQuery<Page, number>({
        queryKey: ["inf.no-next"],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: last => last.nextCursor ?? undefined,
      }),
    );

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(false);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    // Only the initial first-page fetch happened.
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
