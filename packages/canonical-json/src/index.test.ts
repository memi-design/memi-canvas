import { describe, expect, it, vi } from "vitest";

import {
  MAX_CANONICAL_BYTES,
  MAX_CANONICAL_HASH_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  canonicalJson,
  hashCanonicalValue,
  hashCanonicalValueWithByteLimit,
} from "./index.js";

describe("bounded canonical JSON", () => {
  it("sorts object keys deterministically at every depth", () => {
    const left = {
      z: [{ beta: 2, alpha: 1 }],
      a: { delta: true, charlie: null },
    };
    const right = {
      a: { charlie: null, delta: true },
      z: [{ alpha: 1, beta: 2 }],
    };

    expect(canonicalJson(left)).toBe(
      '{"a":{"charlie":null,"delta":true},"z":[{"alpha":1,"beta":2}]}',
    );
    expect(canonicalJson(right)).toBe(canonicalJson(left));
    expect(hashCanonicalValue(right)).toBe(hashCanonicalValue(left));
    expect(hashCanonicalValue(left)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it.each([
    ["undefined", undefined],
    ["bigint", 1n],
    ["symbol", Symbol("hidden")],
    ["function", () => undefined],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["class instance", new (class Example {})()],
  ])("rejects %s values", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it("rejects cyclic, sparse, accessor, hidden, and symbol-bearing data", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const sparse = Array.from({ length: 2 });
    delete sparse[0];
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "unsafe",
    });
    const hidden = Object.defineProperty({}, "value", {
      enumerable: false,
      value: "unsafe",
    });
    const withSymbol = { value: "safe", [Symbol("hidden")]: "unsafe" };

    for (const value of [
      cyclic,
      sparse,
      accessor,
      hidden,
      withSymbol,
    ]) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });

  it("enforces byte, depth, and node budgets", () => {
    expect(() =>
      canonicalJson("x".repeat(MAX_CANONICAL_BYTES + 1)),
    ).toThrow(`exceeds ${MAX_CANONICAL_BYTES} bytes`);

    let deep: unknown = null;
    for (let index = 0; index <= MAX_JSON_DEPTH; index += 1) {
      deep = [deep];
    }
    expect(() => canonicalJson(deep)).toThrow(
      `exceeds ${MAX_JSON_DEPTH} levels`,
    );

    expect(() =>
      canonicalJson(Array.from({ length: MAX_JSON_NODES }, () => null)),
    ).toThrow(`exceeds ${MAX_JSON_NODES} JSON nodes`);
  });

  it("requires an explicit bounded opt-in for larger canonical hashes", () => {
    const large = { payload: "x".repeat(MAX_CANONICAL_BYTES) };

    expect(() => hashCanonicalValue(large)).toThrow(
      `exceeds ${MAX_CANONICAL_BYTES} bytes`,
    );
    expect(
      hashCanonicalValueWithByteLimit(
        large,
        MAX_CANONICAL_BYTES + 128,
      ),
    ).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() =>
      hashCanonicalValueWithByteLimit(
        large,
        MAX_CANONICAL_HASH_BYTES + 1,
      ),
    ).toThrow(`between 1 and ${MAX_CANONICAL_HASH_BYTES}`);
  });

  it("uses one portable key order rather than locale collation", () => {
    const value = {
      "ä": 1,
      z: 2,
      A: 3,
    };

    expect(canonicalJson(value)).toBe('{"A":3,"z":2,"ä":1}');
  });

  it("hashes canonical UTF-8 values without Node globals", () => {
    vi.stubGlobal("Buffer", undefined);
    try {
      expect(hashCanonicalValue({ hello: "world" })).toBe(
        "sha256:93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588",
      );
      expect(hashCanonicalValue("😀")).toBe(
        "sha256:7a0c50b92434b015545fe93ab723db2d4b2cdd14a441405624a9ce8be29f1d5a",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
