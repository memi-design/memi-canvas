import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSigningRequirement,
  artifactFileNames,
  createReleaseManifest,
  discoverReleaseBundle,
  projectSigningState,
  releaseVersion,
  sha256File,
  shouldRunPackageRelease,
  type ArtifactRecord,
} from "./package-macos-release.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "memi-release-contract-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("macOS release packaging contract", () => {
  it("runs when vite-node --script makes the package script its entrypoint", () => {
    const scriptPath = join(process.cwd(), "scripts", "package-macos-release.ts");

    expect(
      shouldRunPackageRelease([
        process.execPath,
        scriptPath,
        "--tag",
        "v1.2.3",
      ]),
    ).toBe(true);
  });

  it.each([
    ["v1.2.3", "1.2.3"],
    ["v10.20.30-beta.1", "10.20.30-beta.1"],
  ])("accepts protected semantic release tag %s", (tag, expectedVersion) => {
    expect(releaseVersion(tag)).toBe(expectedVersion);
  });

  it.each(["1.2.3", "v1.2", "v1.2.3/../../main", "v1.2.3-"])(
    "rejects non-release tag %s",
    (tag) => {
      expect(() => releaseVersion(tag)).toThrow(/must match/u);
    },
  );

  it("discovers exactly one release app and one DMG", async () => {
    const bundleBase = await temporaryDirectory();
    const appPath = join(bundleBase, "macos", "Memi Canvas.app");
    const dmgPath = join(bundleBase, "dmg", "Memi Canvas_1.2.3_aarch64.dmg");
    await mkdir(appPath, { recursive: true });
    await mkdir(join(bundleBase, "dmg"), { recursive: true });
    await writeFile(dmgPath, "dmg", "utf8");

    await expect(discoverReleaseBundle(bundleBase)).resolves.toEqual({
      appPath,
      dmgPath,
    });
  });

  it("rejects ambiguous release bundle discovery", async () => {
    const bundleBase = await temporaryDirectory();
    await mkdir(join(bundleBase, "macos", "Memi Canvas.app"), {
      recursive: true,
    });
    await mkdir(join(bundleBase, "macos", "Unexpected.app"), {
      recursive: true,
    });
    await mkdir(join(bundleBase, "dmg"), { recursive: true });
    await writeFile(join(bundleBase, "dmg", "Memi.dmg"), "dmg", "utf8");

    await expect(discoverReleaseBundle(bundleBase)).rejects.toThrow(
      /found 2/u,
    );
  });

  it("projects exact versioned filenames and stable arm64 aliases", () => {
    expect(artifactFileNames("1.2.3", "arm64")).toEqual({
      dmg: "Memi.Canvas-1.2.3-arm64.dmg",
      appZip: "Memi.Canvas-1.2.3-arm64.app.zip",
      latestDmg: "Memi.Canvas-latest-arm64.dmg",
      latestAppZip: "Memi.Canvas-latest-arm64.app.zip",
    });
  });

  it("calculates the checksum from the artifact bytes", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.dmg");
    const contents = Buffer.from("immutable release bytes\n", "utf8");
    await writeFile(artifactPath, contents);

    await expect(sha256File(artifactPath)).resolves.toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
  });

  it("records immutable source and GitHub Actions run provenance", () => {
    const artifacts: readonly ArtifactRecord[] = [
      {
        name: "Memi.Canvas-1.2.3-arm64.dmg",
        kind: "dmg",
        sha256: "a".repeat(64),
        sizeBytes: 42,
      },
    ];

    expect(
      createReleaseManifest({
        tag: "v1.2.3",
        architecture: "arm64",
        sourceSha: "0123456789abcdef0123456789abcdef01234567",
        repository: "memi-design/memi-canvas",
        workflowRef:
          "memi-design/memi-canvas/.github/workflows/macos-release.yml@refs/tags/v1.2.3",
        runId: "123456789",
        runAttempt: "2",
        serverUrl: "https://github.com",
        signed: true,
        notarized: true,
        artifacts,
      }),
    ).toMatchObject({
      schema: "memi.macos-release.v2",
      tag: "v1.2.3",
      version: "1.2.3",
      architecture: "arm64",
      source: {
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
      provenance: {
        provider: "github-actions",
        repository: "memi-design/memi-canvas",
        workflowRef:
          "memi-design/memi-canvas/.github/workflows/macos-release.yml@refs/tags/v1.2.3",
        runId: "123456789",
        runAttempt: 2,
        runUrl:
          "https://github.com/memi-design/memi-canvas/actions/runs/123456789/attempts/2",
      },
      signed: true,
      notarized: true,
      artifacts,
    });
  });

  it("rejects mutable or malformed provenance", () => {
    expect(() =>
      createReleaseManifest({
        tag: "v1.2.3",
        architecture: "arm64",
        sourceSha: "main",
        repository: "memi-design/memi-canvas",
        workflowRef: "workflow@main",
        runId: "run",
        runAttempt: "zero",
        serverUrl: "https://github.com",
        signed: false,
        notarized: false,
        artifacts: [],
      }),
    ).toThrow(/source SHA/u);
  });

  it.each([
    {
      signatureExitCode: 1,
      identityDetails: "",
      notarizationExitCode: 0,
      expected: { signed: false, notarized: false },
    },
    {
      signatureExitCode: 0,
      identityDetails: "Authority=Developer ID Application: Memi Design",
      notarizationExitCode: 1,
      expected: { signed: true, notarized: false },
    },
    {
      signatureExitCode: 0,
      identityDetails: "Authority=Developer ID Application: Memi Design",
      notarizationExitCode: 0,
      expected: { signed: true, notarized: true },
    },
  ])("projects signing state without overstating notarization", (fixture) => {
    expect(projectSigningState(fixture)).toEqual(fixture.expected);
  });

  it("fails closed when configured release signing is incomplete", () => {
    expect(() =>
      assertSigningRequirement({
        requireSigned: true,
        signed: true,
        notarized: false,
      }),
    ).toThrow(/signed and notarized/u);
    expect(() =>
      assertSigningRequirement({
        requireSigned: true,
        signed: false,
        notarized: false,
      }),
    ).toThrow(/signed and notarized/u);
  });

  it("allows an explicitly unsigned preview when signing is not configured", () => {
    expect(() =>
      assertSigningRequirement({
        requireSigned: false,
        signed: false,
        notarized: false,
      }),
    ).not.toThrow();
  });
});
