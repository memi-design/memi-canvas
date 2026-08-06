import { describe, expect, it } from "vitest";

import {
  createRepositoryGitSandboxProfile,
  resolveTrustedAppleGitAuthority,
} from "./node-process.js";

const COMMAND_LINE_GIT = "/Library/Developer/CommandLineTools/usr/bin/git";
const COMMAND_LINE_GIT_CORE =
  "/Library/Developer/CommandLineTools/usr/libexec/git-core";
const XCODE_GIT = "/Applications/Xcode.app/Contents/Developer/usr/bin/git";
const VERSIONED_XCODE_GIT =
  "/Applications/Xcode_16.4.app/Contents/Developer/usr/bin/git";
const VERSIONED_XCODE_GIT_CORE =
  "/Applications/Xcode_16.4.app/Contents/Developer/usr/libexec/git-core";

describe("resolveTrustedAppleGitAuthority", () => {
  it("prefers the fixed Command Line Tools Git and derives its git-core without executing it", async () => {
    const observed: string[] = [];
    const resolve = async (path: string): Promise<string> => {
      observed.push(path);
      return path;
    };

    await expect(resolveTrustedAppleGitAuthority({ resolve })).resolves.toEqual({
      executable: COMMAND_LINE_GIT,
      gitCorePath: COMMAND_LINE_GIT_CORE,
    });
    expect(observed).toEqual([COMMAND_LINE_GIT, COMMAND_LINE_GIT_CORE]);
  });

  it("canonicalizes the fixed Xcode entrypoint to a versioned direct Git binary", async () => {
    const resolve = async (path: string): Promise<string> => {
      if (path === COMMAND_LINE_GIT) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      if (path === XCODE_GIT) return VERSIONED_XCODE_GIT;
      return VERSIONED_XCODE_GIT_CORE;
    };

    await expect(resolveTrustedAppleGitAuthority({ resolve })).resolves.toEqual({
      executable: VERSIONED_XCODE_GIT,
      gitCorePath: VERSIONED_XCODE_GIT_CORE,
    });
  });

  it("rejects a fixed entrypoint that canonicalizes outside Apple developer toolchains", async () => {
    const resolve = async (path: string): Promise<string> => {
      if (path === COMMAND_LINE_GIT) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return "/tmp/untrusted-git";
    };

    await expect(resolveTrustedAppleGitAuthority({ resolve })).rejects.toMatchObject({
      code: "git-failed",
    });
  });

  it("rejects a direct Git whose adjacent git-core escapes its toolchain", async () => {
    const resolve = async (path: string): Promise<string> =>
      path === COMMAND_LINE_GIT_CORE ? "/tmp/untrusted-git-core" : path;

    await expect(resolveTrustedAppleGitAuthority({ resolve })).rejects.toMatchObject({
      code: "git-failed",
    });
  });
});

describe("createRepositoryGitSandboxProfile", () => {
  it("allows only the checkout, managed root, and immutable Apple Git runtime reads", () => {
    const profile = createRepositoryGitSandboxProfile({
      authority: {
        executable: COMMAND_LINE_GIT,
        gitCorePath: COMMAND_LINE_GIT_CORE,
      },
      managedRoot: "/private/tmp/memi-managed",
      sourceRoot: "/private/tmp/memi-source",
    });

    expect(profile).not.toContain("\n(allow file-read*)\n");
    expect(profile).toContain(
      '(allow file-read* (subpath "/private/tmp/memi-source"))',
    );
    expect(profile).toContain(
      '(allow file-read* (subpath "/private/tmp/memi-managed"))',
    );
    expect(profile).toContain(
      `(allow file-read* (literal "${COMMAND_LINE_GIT}"))`,
    );
    expect(profile).toContain(
      `(allow file-read* (subpath "${COMMAND_LINE_GIT_CORE}"))`,
    );
    expect(profile).not.toContain('(subpath "/Users")');
    expect(profile).not.toContain('(subpath "/private")');
  });
});
