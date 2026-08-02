import { validateRepositoryManifest } from "./boundary.js";
import {
  discoverExpoApplication,
  discoverExpoWebApplication,
  isExpoPackage,
  type PackageManifest,
} from "./expo.js";
import { discoverReactApplication, isReactPackage } from "./react-web.js";
import { discoverSwiftUIApplications } from "./swiftui.js";
import type {
  CaptureApplicationDiscoveryResult,
  CaptureApplicationUnit,
  CaptureDiscoveryError,
  CaptureDiscoveryOptions,
  RepositoryManifestInput,
} from "./types.js";
import { relativeRoot } from "./shared.js";

function invalidPackageError(path: string): CaptureDiscoveryError {
  return {
    code: "invalid-package-manifest",
    path,
    message: "package.json is not valid JSON object data.",
    remediation: "Repair package.json and retry application discovery.",
    retryable: true,
  };
}

function unsupportedPackageError(path: string): CaptureDiscoveryError {
  return {
    code: "unsupported-application",
    path,
    message: "Package does not identify a supported visual application.",
    remediation:
      "Import an Expo Router, React web, or SwiftUI application, or add a supported adapter.",
    retryable: false,
  };
}

function hasRunnableApplicationScript(manifest: PackageManifest): boolean {
  return ["start", "dev", "ios"].some((name) => {
    const script = manifest.scripts?.[name];
    return typeof script === "string" && script.trim().length > 0;
  });
}

function parsePackage(
  content: string,
): { readonly manifest: PackageManifest } | { readonly error: true } {
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { error: true };
    }
    return { manifest: value as PackageManifest };
  } catch {
    return { error: true };
  }
}

export function discoverCaptureApplications(
  input: RepositoryManifestInput,
  options: CaptureDiscoveryOptions = {},
): CaptureApplicationDiscoveryResult {
  const { entries, repositoryFingerprint } = validateRepositoryManifest(input);
  const errors: CaptureDiscoveryError[] = [];
  const packages: Array<{
    readonly path: string;
    readonly root: string;
    readonly manifest: PackageManifest;
  }> = [];
  for (const entry of entries.filter(({ path }) =>
    path.endsWith("package.json"),
  )) {
    const parsed = parsePackage(entry.content);
    if ("error" in parsed) {
      errors.push(invalidPackageError(entry.path));
      continue;
    }
    packages.push({
      path: entry.path,
      root: relativeRoot(entry.path),
      manifest: parsed.manifest,
    });
  }
  const expoNativeRoots = new Set(
    packages
      .filter(({ manifest }) => isExpoPackage(manifest))
      .map(({ root }) => (root === "." ? "ios" : `${root}/ios`)),
  );
  const applications: CaptureApplicationUnit[] =
    discoverSwiftUIApplications({ entries, repositoryFingerprint }).filter(
      ({ root }) => !expoNativeRoots.has(root),
    );

  for (const entry of packages) {
    if (isExpoPackage(entry.manifest)) {
      applications.push(
        discoverExpoApplication({
          root: entry.root,
          manifestPath: entry.path,
          manifest: entry.manifest,
          entries,
          repositoryFingerprint,
          options,
        }),
      );
      const expoWeb = discoverExpoWebApplication({
        root: entry.root,
        manifestPath: entry.path,
        manifest: entry.manifest,
        entries,
        repositoryFingerprint,
      });
      if (expoWeb !== null) {
        applications.push(expoWeb);
      }
    } else if (isReactPackage(entry.manifest)) {
      applications.push(
        discoverReactApplication({
          root: entry.root,
          manifestPath: entry.path,
          manifest: entry.manifest,
          entries,
          repositoryFingerprint,
        }),
      );
    } else if (hasRunnableApplicationScript(entry.manifest)) {
      errors.push(unsupportedPackageError(entry.path));
    }
  }

  return {
    schemaVersion: 1,
    executedProjectCode: false,
    repositoryFingerprint,
    applications: applications.sort((left, right) => {
      const byRoot = left.root.localeCompare(right.root);
      return byRoot === 0 ? left.platform.localeCompare(right.platform) : byRoot;
    }),
    errors: errors.sort((left, right) => left.path.localeCompare(right.path)),
  };
}
