import { describe, expect, it } from "vitest";

import {
  BoundedRedactedLog,
  redactLogMessage,
} from "./redacted-log.js";

describe("BoundedRedactedLog", () => {
  it("uses safe defaults", () => {
    const log = new BoundedRedactedLog();
    log.append("ready");
    expect(log.snapshot()).toEqual(["ready"]);
  });

  it("redacts secrets and retains only a bounded immutable tail", () => {
    const log = new BoundedRedactedLog({ maximumEntries: 2, maximumLength: 80 });
    log.append("first");
    log.append("Authorization: Bearer super-secret");
    log.append("TOKEN=abc123 /Users/person/private/file.ts user@example.com");

    const entries = log.snapshot();

    expect(entries).toHaveLength(2);
    expect(entries.join(" ")).not.toContain("super-secret");
    expect(entries.join(" ")).not.toContain("abc123");
    expect(entries.join(" ")).not.toContain("/Users/person");
    expect(entries.join(" ")).not.toContain("user@example.com");
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it("redacts common unlabeled provider credentials and URL userinfo", () => {
    const message = [
      ["sk", "proj", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"].join("-"),
      ["ghp", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"].join("_"),
      ["xoxb", "1111111111", "2222222222", "CCCCCCCCCCCCCCCC"].join("-"),
      ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
      ["AIzaSy", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"].join(""),
      ["sk", "live", "DDDDDDDDDDDDDDDDDDDDDDDD"].join("_"),
      "https://fixture-user:fixture-password@example.invalid/path",
    ].join(" ");

    const redacted = redactLogMessage(message);

    expect(redacted).not.toContain("AAAAAAAA");
    expect(redacted).not.toContain("BBBBBBBB");
    expect(redacted).not.toContain("CCCCCCCC");
    expect(redacted).not.toContain("AKIA");
    expect(redacted).not.toContain("AIza");
    expect(redacted).not.toContain("DDDDDDDD");
    expect(redacted).not.toContain("fixture-password");
    expect(redacted).toContain("[PROVIDER_CREDENTIAL_REDACTED]");
    expect(redacted).toContain("https://[URL_CREDENTIAL_REDACTED]@");
  });

  it("retains the redacted diagnostic tail when an external tool is verbose", () => {
    const redacted = redactLogMessage(
      `early diagnostic ${"x".repeat(160)} final failure: sandbox denied write`,
      64,
    );

    expect(redacted).toHaveLength(64);
    expect(redacted).toContain("final failure: sandbox denied write");
    expect(redacted).not.toContain("early diagnostic");
  });

  it("keeps the first actionable tool error when a verbose stack trace follows it", () => {
    const redacted = redactLogMessage(
      `[!] There were changes to the podfile in deployment mode:\nR expo-dev-client\n${"Ruby stack line\n".repeat(200)}`,
      128,
    );

    expect(redacted).toContain("There were changes to the podfile");
    expect(redacted).toContain("R expo-dev-client");
    expect(redacted).toHaveLength(128);
  });
});
