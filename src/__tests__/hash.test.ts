/**
 * Hashing and prefix-matching tests.
 *
 * Two specific failure modes from the old pipe-joined hash:
 *
 *   1. Collisions — `["users", "1|2"]` and `["users", 1, 2]` produced
 *      the same hash because pipe was both a separator and a possible
 *      character inside string values.
 *   2. Sibling false-positives — invalidating `["users", 1]` also
 *      matched `["users", 10]`, `["users", 100]`, etc., because the
 *      match was a raw string `.startsWith`.
 *
 * Both of these are correctness bugs, not perf nits. The current
 * implementation uses canonical JSON and a segment-aware prefix check.
 */
import { describe, expect, it } from "vitest";
import {
  matchesQueryPrefix,
  parseQueryKey,
  serializeQueryKey,
} from "../utils";

describe("serializeQueryKey", () => {
  it("treats different shapes as different hashes", () => {
    expect(parseQueryKey(["users", "1|2"])).not.toBe(
      parseQueryKey(["users", 1, 2]),
    );
  });

  it("is stable across object-key insertion order", () => {
    const a = parseQueryKey(["users", { role: "admin", active: true }]);
    const b = parseQueryKey(["users", { active: true, role: "admin" }]);
    expect(a).toBe(b);
  });

  it("encodes nested arrays and objects", () => {
    const out = parseQueryKey(["users", { ids: [1, 2, 3] }]);
    expect(JSON.parse(out)).toEqual(["users", { ids: [1, 2, 3] }]);
  });

  it("serializes primitives directly", () => {
    expect(serializeQueryKey("hello")).toBe('"hello"');
    expect(serializeQueryKey(42)).toBe("42");
  });
});

describe("matchesQueryPrefix (segment-aware)", () => {
  it("matches exact prefix", () => {
    const prefix = parseQueryKey(["users", 1]);
    const same = parseQueryKey(["users", 1]);
    expect(matchesQueryPrefix(same, prefix)).toBe(true);
  });

  it("matches deeper children of the prefix", () => {
    const prefix = parseQueryKey(["users", 1]);
    const child = parseQueryKey(["users", 1, "profile"]);
    expect(matchesQueryPrefix(child, prefix)).toBe(true);
  });

  it("does NOT match numeric siblings", () => {
    const prefix = parseQueryKey(["users", 1]);
    expect(matchesQueryPrefix(parseQueryKey(["users", 10]), prefix)).toBe(false);
    expect(matchesQueryPrefix(parseQueryKey(["users", 100]), prefix)).toBe(false);
    expect(matchesQueryPrefix(parseQueryKey(["users", 1000]), prefix)).toBe(
      false,
    );
  });

  it("does NOT match string siblings that happen to share a prefix", () => {
    const prefix = parseQueryKey(["users", "a"]);
    expect(matchesQueryPrefix(parseQueryKey(["users", "ab"]), prefix)).toBe(
      false,
    );
    expect(matchesQueryPrefix(parseQueryKey(["users", "abc"]), prefix)).toBe(
      false,
    );
  });

  it("does NOT match completely unrelated keys", () => {
    const prefix = parseQueryKey(["users"]);
    expect(matchesQueryPrefix(parseQueryKey(["posts"]), prefix)).toBe(false);
  });
});
