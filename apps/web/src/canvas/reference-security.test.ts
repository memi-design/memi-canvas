import { describe, expect, it } from "vitest";

import {
  assertSafeReferenceSourceUrl,
  isSafeReferenceSourceUrl,
} from "./reference-security.js";

describe("reference evidence URL policy", () => {
  it("accepts internal source identities and explicit loopback evidence", () => {
    expect(
      isSafeReferenceSourceUrl(
        "memi-source://repository/app/screens/home.tsx",
      ),
    ).toBe(true);
    expect(
      isSafeReferenceSourceUrl("http://127.0.0.1:43821/evidence/home"),
    ).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///Users/person/Secrets.txt",
    "https://example.com/evidence",
    "http://localhost/no-explicit-port",
    "http://token@127.0.0.1:43821/evidence",
  ])("rejects active or externally addressable evidence URL %s", (value) => {
    expect(isSafeReferenceSourceUrl(value)).toBe(false);
    expect(() => assertSafeReferenceSourceUrl(value)).toThrow(
      /internal source identity|loopback/u,
    );
  });
});
