import { describe, expect, it } from "vitest";

import {
  discoverCaptureApplications,
  validateCaptureApplicationConfiguration,
  type RepositoryManifestInput,
} from "./index.js";

const manifest = (
  entries: RepositoryManifestInput["entries"],
): RepositoryManifestInput => ({
  schemaVersion: 1,
  repository: {
    revision: "0123456789abcdef0123456789abcdef01234567",
    dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
  },
  budgets: {
    maxEntries: 64,
    maxFileBytes: 32 * 1024,
    maxTotalBytes: 256 * 1024,
    maxDepth: 12,
  },
  entries,
});

describe("native capture configuration", () => {
  it("rejects standalone Expo without checked-in native build authority", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "native-missing",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Native Missing",
              slug: "native-missing",
              ios: { bundleIdentifier: "com.example.native-missing" },
            },
          }),
        },
        { path: "app/index.tsx", content: "export default 1" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      buildRecipe: null,
      captureConfiguration: null,
      errors: [
        expect.objectContaining({
          code: "expo-native-container-required",
          remediation: expect.stringMatching(/Expo Go|native iOS/i),
        }),
      ],
    });
  });

  it("prefers a SwiftUI workspace named after the project", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "ios/App.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/App.xcworkspace/contents.xcworkspacedata",
          content: "<Workspace />",
        },
        {
          path: "ios/Pods.xcworkspace/contents.xcworkspacedata",
          content: "<Workspace />",
        },
        {
          path: "ios/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme",
          content: "<Scheme />",
        },
        { path: "ios/AppApp.swift", content: "@main struct AppApp: App {}" },
        { path: "ios/HomeView.swift", content: "struct HomeView: View {}" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "supported",
      captureConfiguration: {
        kind: "swiftui",
        container: {
          kind: "workspace",
          relativePath: "App.xcworkspace",
        },
      },
    });
  });

  it("does not map an empty catch-all deep link to a required Expo segment", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "docs",
            main: "expo-router/entry",
            scripts: { start: "expo start --go" },
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: { name: "Docs", slug: "docs" },
          }),
        },
        {
          path: ".maestro/docs.yaml",
          content: [
            "appId: host.exp.Exponent",
            "---",
            '- openLink: "exp://127.0.0.1:8081/--/docs"',
          ].join("\n"),
        },
        {
          path: "app/docs/[...parts].tsx",
          content: "export default 1",
        },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      captureConfiguration: null,
      errors: [
        expect.objectContaining({
          code: "expo-maestro-flow-unmapped",
          path: ".maestro/docs.yaml",
        }),
      ],
    });
  });

  it("validates configuration invariants at the consumer boundary", () => {
    expect(() =>
      validateCaptureApplicationConfiguration({
        kind: "expo-ios",
        runtime: "standalone",
        bundleId: null,
        appConfigPath: "app.json",
        entryPoint: "expo-router/entry",
        scheme: null,
        nativeBuild: null,
        metro: null,
        maestroFlowPaths: [],
        maestroFlows: [],
      }),
    ).toThrow(/bundle identifier/i);

    expect(() =>
      validateCaptureApplicationConfiguration({
        kind: "swiftui",
        container: {
          kind: "project",
          relativePath: "../Escape.xcodeproj",
        },
        scheme: "App",
        schemePath: "App.xcodeproj/xcshareddata/xcschemes/App.xcscheme",
        derivedDataRelativePath: ".memi/capture/derived-data/app_example",
        requiresResolvedBuildSettings: true,
        buildSettingsResolution: {
          executable: "xcodebuild",
          args: [],
          requiredKeys: [
            "PRODUCT_BUNDLE_IDENTIFIER",
            "TARGET_BUILD_DIR",
            "FULL_PRODUCT_NAME",
          ],
        },
      }),
    ).toThrow(/contained relative path/i);

    expect(() =>
      validateCaptureApplicationConfiguration({
        kind: "expo-ios",
        runtime: "standalone",
        bundleId: "com.example.app",
        appConfigPath: "app.json",
        entryPoint: "expo-router/entry",
        scheme: "example",
        nativeBuild: {
          container: {
            kind: "project",
            relativePath: "ios/App.xcodeproj",
          },
          scheme: "App",
          schemePath:
            "ios/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme",
          configuration: "Release",
          derivedDataRelativePath:
            ".memi/capture/derived-data/app_example",
          requiresResolvedBuildSettings: true,
          buildSettingsResolution: {
            executable: "xcodebuild",
            args: [
              "-project",
              "ios/Wrong.xcodeproj",
              "-scheme",
              "App",
              "-configuration",
              "Release",
              "-sdk",
              "iphonesimulator",
              "-derivedDataPath",
              ".memi/capture/derived-data/app_example",
              "-showBuildSettings",
            ],
            requiredKeys: [
              "PRODUCT_BUNDLE_IDENTIFIER",
              "TARGET_BUILD_DIR",
              "FULL_PRODUCT_NAME",
            ],
          },
        },
        metro: null,
        maestroFlowPaths: [],
        maestroFlows: [],
      }),
    ).toThrow(/build settings recipe/i);
  });
});
