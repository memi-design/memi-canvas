import { describe, expect, it } from "vitest";

import {
  discoverCaptureApplications,
  type RepositoryManifestInput,
} from "./index.js";

const budgets = {
  maxEntries: 64,
  maxFileBytes: 32 * 1024,
  maxTotalBytes: 256 * 1024,
  maxDepth: 12,
} as const;

function manifest(
  entries: RepositoryManifestInput["entries"],
): RepositoryManifestInput {
  return {
    schemaVersion: 1,
    repository: {
      revision: "0123456789abcdef0123456789abcdef01234567",
      dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
    },
    budgets,
    entries,
  };
}

describe("capture-platform discovery", () => {
  it("attests a uniquely-targeted application Maestro flow to its planned route", () => {
    const profileFlow = [
      "appId: com.example.canvas",
      "---",
      "- launchApp:",
      "    clearState: false",
      "- tapOn:",
      '    id: "profile-button"',
      '- assertVisible: "Edit profile"',
    ].join("\n");
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "canvas",
            main: "expo-router/entry",
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Canvas",
              scheme: "canvas",
              ios: { bundleIdentifier: "com.example.canvas" },
            },
          }),
        },
        { path: "ios/Canvas.xcodeproj/project.pbxproj", content: "// project" },
        {
          path: "ios/Canvas.xcodeproj/xcshareddata/xcschemes/Canvas.xcscheme",
          content: "<Scheme />",
        },
        { path: ".maestro/profile-design-system.yml", content: profileFlow },
        { path: "app/(tabs)/index.tsx", content: "export default 1" },
        { path: "app/(tabs)/profile.tsx", content: "export default 1" },
        { path: "app/_layout.tsx", content: "export default 1" },
      ]),
    );

    const application = result.applications[0];
    expect(application).toBeDefined();
    const flow = (application!.captureConfiguration as {
      readonly maestroFlows: readonly {
        readonly relativePath: string;
        readonly contentHash?: string;
        readonly captureRoutePath?: string | null;
      }[];
    }).maestroFlows[0];
    expect(flow).toMatchObject({
      relativePath: ".maestro/profile-design-system.yml",
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      captureRoutePath: "/profile",
    });
  });

  it("discovers Expo Router routes without executing project code", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "buzzr",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: {
              expo: "53.0.0",
              "expo-router": "5.0.0",
              "expo-dev-client": "6.0.0",
              react: "19.0.0",
            },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Buzzr",
              slug: "buzzr",
              scheme: "buzzr",
              ios: { bundleIdentifier: "com.buzzr.app" },
            },
          }),
        },
        {
          path: ".maestro/game-detail.yaml",
          content: [
            "appId: com.buzzr.app",
            "---",
            '- openLink: "buzzr://games/fixture-game"',
          ].join("\n"),
        },
        {
          path: "ios/Buzzr.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/Buzzr.xcworkspace/contents.xcworkspacedata",
          content: "<Workspace />",
        },
        {
          path: "ios/Buzzr.xcodeproj/xcshareddata/xcschemes/Buzzr.xcscheme",
          content: "<Scheme />",
        },
        { path: "app/(auth)/sign-in.tsx", content: "export default 1" },
        { path: "app/(tabs)/index.tsx", content: "export default 1" },
        { path: "app/(tabs)/games/[gameId].tsx", content: "export default 1" },
        { path: "app/_layout.tsx", content: "export default 1" },
        { path: "app/+not-found.tsx", content: "export default 1" },
        { path: "app/ping+api.ts", content: "export function GET() {}" },
      ]),
    );

    expect(result.executedProjectCode).toBe(false);
    expect(result.applications).toHaveLength(1);
    const application = result.applications[0]!;
    expect(application).toMatchObject({
      platform: "expo-ios",
      root: ".",
      status: "supported",
      displayName: "buzzr",
      pipelineStages: [
        "validate",
        "inventory",
        "plan",
        "prepare-fixtures",
        "build",
        "launch",
        "capture",
        "extract-layers",
        "verify",
        "save",
      ],
    });
    expect(application.buildRecipe).toEqual({
      executable: "xcodebuild",
      args: [
        "-workspace",
        "ios/Buzzr.xcworkspace",
        "-scheme",
        "Buzzr",
        "-configuration",
        "Release",
        "-sdk",
        "iphonesimulator",
        "-jobs",
        "1",
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        ".memi/capture/derived-data/app_02a81eea72af7c139ccd93f9",
        "ENABLE_USER_SCRIPT_SANDBOXING=YES",
        "build",
      ],
      cwd: ".",
      purpose: "build",
    });
    expect(application.captureConfiguration).toEqual({
      kind: "expo-ios",
      runtime: "standalone",
      bundleId: "com.buzzr.app",
      appConfigPath: "app.json",
      entryPoint: "expo-router/entry",
      scheme: "buzzr",
      nativeBuild: {
        container: {
          kind: "workspace",
          relativePath: "ios/Buzzr.xcworkspace",
        },
        scheme: "Buzzr",
        schemePath:
          "ios/Buzzr.xcodeproj/xcshareddata/xcschemes/Buzzr.xcscheme",
        configuration: "Release",
        derivedDataRelativePath:
          ".memi/capture/derived-data/app_02a81eea72af7c139ccd93f9",
        requiresResolvedBuildSettings: true,
        buildSettingsResolution: {
          executable: "xcodebuild",
          args: [
            "-workspace",
            "ios/Buzzr.xcworkspace",
            "-scheme",
            "Buzzr",
            "-configuration",
            "Release",
            "-sdk",
            "iphonesimulator",
            "-jobs",
            "1",
            "-destination",
            "generic/platform=iOS Simulator",
            "-derivedDataPath",
            ".memi/capture/derived-data/app_02a81eea72af7c139ccd93f9",
            "ENABLE_USER_SCRIPT_SANDBOXING=YES",
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
      maestroFlowPaths: [".maestro/game-detail.yaml"],
      maestroFlows: [
        expect.objectContaining({
          relativePath: ".maestro/game-detail.yaml",
          appId: "com.buzzr.app",
          deepLink: "buzzr://games/fixture-game",
          routePath: "/games/:gameId",
          mapping: "route",
        }),
      ],
    });
    expect(application.routes.map((route) => route.path)).toEqual([
      "/",
      "/games/:gameId",
      "/sign-in",
    ]);
    expect(application.scenarios).toEqual([
      expect.objectContaining({
        routePath: "/",
        authContext: "public",
        viewport: { name: "ios-mobile", width: 402, height: 874, scale: 3 },
      }),
      expect.objectContaining({
        routePath: "/games/:gameId",
        authContext: "public",
        fixture: {
          status: "required",
          parameterNames: ["gameId"],
        },
        viewport: { name: "ios-mobile", width: 402, height: 874, scale: 3 },
      }),
      expect.objectContaining({
        routePath: "/sign-in",
        authContext: "signed-out",
        viewport: { name: "ios-mobile", width: 402, height: 874, scale: 3 },
      }),
    ]);
  });

  it("plans a mobile-sized Expo web capture alongside the native iOS application", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "buzzr",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: {
              expo: "54.0.0",
              "expo-router": "6.0.0",
              react: "19.0.0",
              "react-dom": "19.0.0",
              "react-native-web": "0.21.0",
            },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Buzzr",
              ios: { bundleIdentifier: "com.buzzr.app" },
            },
          }),
        },
        { path: "ios/Buzzr.xcodeproj/project.pbxproj", content: "// project" },
        {
          path: "ios/Buzzr.xcodeproj/xcshareddata/xcschemes/Buzzr.xcscheme",
          content: "<Scheme />",
        },
        { path: "app/(tabs)/index.tsx", content: "export default 1" },
        { path: "app/(tabs)/profile.tsx", content: "export default 1" },
        { path: "app/_layout.tsx", content: "export default 1" },
      ]),
    );

    expect(result.applications.map(({ platform }) => platform)).toEqual([
      "expo-ios",
      "react-web",
    ]);
    const web = result.applications.find(({ platform }) => platform === "react-web");
    expect(web).toMatchObject({
      status: "supported",
      root: ".",
      buildRecipe: {
        executable: "npm",
        args: [
          "run",
          "start",
          "--",
          "--web",
          "--localhost",
          "--port",
          "{leasedPort}",
        ],
        cwd: ".",
        purpose: "launch",
      },
    });
    expect(web?.scenarios).toEqual([
      expect.objectContaining({
        routePath: "/",
        viewport: { name: "ios-mobile", width: 390, height: 844, scale: 3 },
      }),
      expect.objectContaining({
        routePath: "/profile",
        viewport: { name: "ios-mobile", width: 390, height: 844, scale: 3 },
      }),
    ]);
  });

  it("surfaces explicit Expo Go mode without inventing a bundle identifier", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "apps/mobile/package.json",
          content: JSON.stringify({
            name: "expo-go-app",
            main: "expo-router/entry",
            scripts: { start: "expo start --go" },
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "apps/mobile/app.json",
          content: JSON.stringify({
            expo: {
              name: "Expo Go App",
              slug: "expo-go-app",
              extra: { memi: { capture: { mode: "expo-go" } } },
            },
          }),
        },
        {
          path: "apps/mobile/app/index.tsx",
          content: "export default 1",
        },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "supported",
      captureConfiguration: {
        kind: "expo-ios",
        runtime: "expo-go",
        bundleId: null,
        appConfigPath: "app.json",
        entryPoint: "expo-router/entry",
        scheme: null,
        nativeBuild: null,
        metro: {
          executable: "npx",
          args: ["expo", "start", "--go", "--localhost"],
          appId: "host.exp.Exponent",
          routeAuthority: "expo-go-project-url",
        },
        maestroFlowPaths: [],
        maestroFlows: [],
      },
    });
  });

  it("uses an installed development-client authority instead of planning a native rebuild", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "development-client-app",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: {
              expo: "54",
              "expo-router": "6",
              "expo-dev-client": "6",
            },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Development Client App",
              slug: "development-client-app",
              scheme: "example",
              ios: { bundleIdentifier: "com.example.client" },
            },
          }),
        },
        { path: "app/index.tsx", content: "export default 1" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "supported",
      buildRecipe: {
        executable: "npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        purpose: "launch",
      },
      captureConfiguration: {
        kind: "expo-ios",
        runtime: "development-client",
        bundleId: "com.example.client",
        scheme: "example",
        nativeBuild: null,
        metro: {
          executable: "npx",
          args: ["expo", "start", "--dev-client", "--localhost"],
          appId: "com.example.client",
          routeAuthority: "expo-development-client-url",
          scheme: "exp+development-client-app",
        },
      },
    });
  });

  it("uses a user-selected existing development client over checked-in iOS build authority", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "selected-development-client-app",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: {
              expo: "54",
              "expo-router": "6",
              "expo-dev-client": "6",
            },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Selected Development Client App",
              scheme: "selected-client",
              ios: { bundleIdentifier: "com.example.selectedclient" },
            },
          }),
        },
        {
          path: "ios/SelectedDevelopmentClientApp.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/SelectedDevelopmentClientApp.xcodeproj/xcshareddata/xcschemes/SelectedDevelopmentClientApp.xcscheme",
          content: "<Scheme />",
        },
        { path: "app/index.tsx", content: "export default 1" },
      ]),
      { expoRuntime: "existing-development-client" },
    );

    expect(result.applications[0]).toMatchObject({
      status: "supported",
      buildRecipe: {
        executable: "npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        purpose: "launch",
      },
      captureConfiguration: {
        kind: "expo-ios",
        runtime: "development-client",
        bundleId: "com.example.selectedclient",
        scheme: "selected-client",
        nativeBuild: null,
        metro: {
          executable: "npx",
          args: ["expo", "start", "--dev-client", "--localhost"],
          appId: "com.example.selectedclient",
          routeAuthority: "expo-development-client-url",
          scheme: "exp+selected-client",
        },
      },
    });
  });

  it("rejects an explicit existing development-client selection without expo-dev-client", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "missing-development-client-package",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: { expo: "54", "expo-router": "6" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Missing Development Client Package",
              scheme: "missing-client-package",
              ios: { bundleIdentifier: "com.example.missingclientpackage" },
            },
          }),
        },
        {
          path: "ios/MissingDevelopmentClientPackage.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/MissingDevelopmentClientPackage.xcodeproj/xcshareddata/xcschemes/MissingDevelopmentClientPackage.xcscheme",
          content: "<Scheme />",
        },
        { path: "app/index.tsx", content: "export default 1" },
      ]),
      { expoRuntime: "existing-development-client" },
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      buildRecipe: null,
      captureConfiguration: null,
      errors: [
        expect.objectContaining({
          code: "expo-development-client-required",
          path: "package.json",
          message: expect.stringMatching(/expo-dev-client/i),
          remediation: expect.stringMatching(/expo-dev-client/i),
          retryable: true,
        }),
      ],
    });
  });

  it("reports the missing static target details for an explicit existing development client", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "missing-development-client-target",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: {
              expo: "54",
              "expo-router": "6",
              "expo-dev-client": "6",
            },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: { name: "Missing Development Client Target" },
          }),
        },
        {
          path: "ios/MissingDevelopmentClientTarget.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/MissingDevelopmentClientTarget.xcodeproj/xcshareddata/xcschemes/MissingDevelopmentClientTarget.xcscheme",
          content: "<Scheme />",
        },
        { path: "app/index.tsx", content: "export default 1" },
      ]),
      { expoRuntime: "existing-development-client" },
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      buildRecipe: null,
      captureConfiguration: null,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "expo-runtime-target-required",
          path: "app.json",
          message: expect.stringMatching(/bundle identifier/i),
          remediation: expect.stringMatching(/expo\.ios\.bundleIdentifier/i),
          retryable: true,
        }),
        expect.objectContaining({
          code: "expo-runtime-target-required",
          path: "app.json",
          message: expect.stringMatching(/URL scheme/i),
          remediation: expect.stringMatching(/expo\.scheme/i),
          retryable: true,
        }),
      ]),
    });
  });

  it("rejects Expo capture when neither a bundle identifier nor explicit Expo Go mode exists", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "ambiguous-expo",
            main: "expo-router/entry",
            scripts: { start: "expo start" },
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: { name: "Ambiguous", slug: "ambiguous" },
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
          code: "expo-runtime-target-required",
          retryable: true,
          remediation: expect.stringMatching(/bundleIdentifier|Expo Go/),
        }),
      ],
    });
  });

  it("rejects a Maestro app identifier that contradicts the static Expo config", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "expo-app",
            main: "expo-router/entry",
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Expo App",
              slug: "expo-app",
              ios: { bundleIdentifier: "com.example.correct" },
            },
          }),
        },
        {
          path: ".maestro/home.yaml",
          content: "appId: com.example.wrong\n---\n- launchApp",
        },
        {
          path: "ios/ExpoApp.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/ExpoApp.xcodeproj/xcshareddata/xcschemes/ExpoApp.xcscheme",
          content: "<Scheme />",
        },
        { path: "app/index.tsx", content: "export default 1" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      captureConfiguration: null,
      errors: [
        expect.objectContaining({
          code: "expo-maestro-app-id-mismatch",
          path: ".maestro/home.yaml",
          remediation: expect.stringMatching(/com\.example\.correct/),
        }),
      ],
    });
  });

  it("discovers React web pages and emits a structured localhost recipe", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "apps/site/package.json",
          content: JSON.stringify({
            name: "dorii-site",
            scripts: { dev: "vite" },
            dependencies: { react: "19.0.0", "react-dom": "19.0.0" },
            devDependencies: { vite: "8.0.0" },
          }),
        },
        {
          path: "apps/site/src/pages/index.tsx",
          content: "export default function Home() {}",
        },
        {
          path: "apps/site/src/pages/about.tsx",
          content: "export default function About() {}",
        },
        {
          path: "apps/site/src/pages/work/[slug].tsx",
          content: "export default function Work() {}",
        },
      ]),
    );

    const application = result.applications[0]!;
    expect(application.platform).toBe("react-web");
    expect(application.routes.map((route) => route.path)).toEqual([
      "/",
      "/about",
      "/work/:slug",
    ]);
    expect(application.buildRecipe).toEqual({
      executable: "npm",
      args: [
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        "{leasedPort}",
      ],
      cwd: "apps/site",
      purpose: "launch",
    });
    expect(application.scenarios.at(-1)?.fixture).toEqual({
      status: "required",
      parameterNames: ["slug"],
    });
  });

  it("plans Next App Router root, grouped, dynamic, and catch-all pages", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "next-app",
            scripts: { start: "next start" },
            dependencies: { next: "16", react: "19" },
          }),
        },
        { path: "src/app/page.tsx", content: "export default 1" },
        {
          path: "src/app/(marketing)/work/[slug]/page.tsx",
          content: "export default 1",
        },
        {
          path: "src/app/docs/[...parts]/page.tsx",
          content: "export default 1",
        },
      ]),
    );

    expect(result.applications[0]?.routes.map(({ path }) => path)).toEqual([
      "/",
      "/docs/:parts*",
      "/work/:slug",
    ]);
  });

  it("keeps unsupported React roots diagnostic and non-executable", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "react-library",
            dependencies: { react: "19" },
          }),
        },
        { path: "src/Button.tsx", content: "export function Button() {}" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      buildRecipe: null,
      routes: [],
      scenarios: [],
      errors: [
        expect.objectContaining({ code: "missing-launch-script" }),
        expect.objectContaining({ code: "no-capturable-routes" }),
      ],
    });
  });

  it("plans a root screen and declared router paths for a Vite React app", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "vite-react",
            scripts: { dev: "vite" },
            dependencies: { react: "19" },
          }),
        },
        {
          path: "src/App.tsx",
          content: `
            export function App() {
              return <>
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:projectId" element={<Project />} />
              </>
            }
          `,
        },
      ]),
    );

    expect(result.applications[0]?.routes.map(({ path }) => path)).toEqual([
      "/",
      "/projects",
      "/projects/:projectId",
    ]);
  });

  it("discovers a SwiftUI workspace and an explicit shared scheme", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "ios/NateTheBait.xcworkspace/contents.xcworkspacedata",
          content: "<Workspace></Workspace>",
        },
        {
          path: "ios/NateTheBait.xcodeproj/project.pbxproj",
          content: "// !$*UTF8*$!",
        },
        {
          path: "ios/NateTheBait.xcodeproj/xcshareddata/xcschemes/NateTheBait.xcscheme",
          content: "<Scheme></Scheme>",
        },
        {
          path: "ios/NateTheBaitApp.swift",
          content: "@main struct NateTheBaitApp: App {}",
        },
        {
          path: "ios/HomeView.swift",
          content: "struct HomeView: View { var body: some View { Text(\"Home\") } }",
        },
        {
          path: "ios/SettingsView.swift",
          content:
            "struct SettingsView: View { var body: some View { Text(\"Settings\") } }",
        },
      ]),
    );

    const application = result.applications[0]!;
    expect(application).toMatchObject({
      platform: "swiftui",
      root: "ios",
      status: "supported",
      displayName: "NateTheBait",
    });
    expect(application.buildRecipe).toEqual({
      executable: "xcodebuild",
      args: [
        "-workspace",
        "NateTheBait.xcworkspace",
        "-scheme",
        "NateTheBait",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-jobs",
        "1",
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        ".memi/capture/derived-data/app_6187a5ed9987052cc5703d20",
        "ENABLE_USER_SCRIPT_SANDBOXING=YES",
        "build",
      ],
      cwd: "ios",
      purpose: "build",
    });
    expect(application.captureConfiguration).toEqual({
      kind: "swiftui",
      container: {
        kind: "workspace",
        relativePath: "NateTheBait.xcworkspace",
      },
      scheme: "NateTheBait",
      schemePath:
        "NateTheBait.xcodeproj/xcshareddata/xcschemes/NateTheBait.xcscheme",
      derivedDataRelativePath:
        ".memi/capture/derived-data/app_6187a5ed9987052cc5703d20",
      requiresResolvedBuildSettings: true,
      buildSettingsResolution: {
        executable: "xcodebuild",
        args: [
          "-workspace",
          "NateTheBait.xcworkspace",
          "-scheme",
          "NateTheBait",
          "-configuration",
          "Debug",
          "-sdk",
          "iphonesimulator",
          "-jobs",
          "1",
          "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          ".memi/capture/derived-data/app_6187a5ed9987052cc5703d20",
          "ENABLE_USER_SCRIPT_SANDBOXING=YES",
          "-showBuildSettings",
        ],
        requiredKeys: [
          "PRODUCT_BUNDLE_IDENTIFIER",
          "TARGET_BUILD_DIR",
          "FULL_PRODUCT_NAME",
        ],
      },
    });
    expect(application.routes.map((route) => route.displayName)).toEqual([
      "Home",
      "Settings",
    ]);
  });

  it("rejects ambiguous SwiftUI workspaces and shared schemes instead of selecting the first", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "ios/App.xcodeproj/project.pbxproj",
          content: "// project",
        },
        {
          path: "ios/One.xcworkspace/contents.xcworkspacedata",
          content: "<Workspace />",
        },
        {
          path: "ios/Two.xcworkspace/contents.xcworkspacedata",
          content: "<Workspace />",
        },
        {
          path: "ios/App.xcodeproj/xcshareddata/xcschemes/Alpha.xcscheme",
          content: "<Scheme />",
        },
        {
          path: "ios/App.xcodeproj/xcshareddata/xcschemes/Beta.xcscheme",
          content: "<Scheme />",
        },
        { path: "ios/AppApp.swift", content: "@main struct AppApp: App {}" },
        { path: "ios/HomeView.swift", content: "struct HomeView: View {}" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      status: "unsupported",
      buildRecipe: null,
      captureConfiguration: null,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "swiftui-container-ambiguous",
          remediation: expect.stringMatching(/one workspace/i),
        }),
        expect.objectContaining({
          code: "swiftui-scheme-ambiguous",
          remediation: expect.stringMatching(/shared scheme/i),
        }),
      ]),
    });
  });

  it("partitions a mixed repository into stable application units", () => {
    const entries = [
      {
        path: "native/package.json",
        content: JSON.stringify({
          name: "native",
          main: "expo-router/entry",
          dependencies: { expo: "53", "expo-router": "5" },
          scripts: { start: "expo start" },
        }),
      },
      { path: "native/app/index.tsx", content: "export default 1" },
      {
        path: "web/package.json",
        content: JSON.stringify({
          name: "web",
          dependencies: { react: "19" },
          scripts: { dev: "vite" },
        }),
      },
      { path: "web/src/pages/index.tsx", content: "export default 1" },
      {
        path: "apple/App.xcodeproj/project.pbxproj",
        content: "// project",
      },
      {
        path: "apple/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme",
        content: "<Scheme />",
      },
      {
        path: "apple/AppApp.swift",
        content: "@main struct AppApp: App {}",
      },
      {
        path: "apple/RootView.swift",
        content: "struct RootView: View {}",
      },
    ] as const;

    const forward = discoverCaptureApplications(manifest(entries));
    const reverse = discoverCaptureApplications(manifest([...entries].reverse()));

    expect(
      forward.applications.map(({ platform, root }) => `${platform}:${root}`),
    ).toEqual([
      "swiftui:apple",
      "expo-ios:native",
      "react-web:web",
    ]);
    expect(reverse).toEqual(forward);
    expect(new Set(forward.applications.map(({ cacheKey }) => cacheKey)).size).toBe(
      3,
    );
  });

  it("ignores nested private library packages without runnable application scripts", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "mobile",
            main: "expo-router/entry",
            scripts: { start: "expo start --go" },
            dependencies: { expo: "53", "expo-router": "5" },
          }),
        },
        {
          path: "app.json",
          content: JSON.stringify({
            expo: {
              name: "Mobile",
              slug: "mobile",
              extra: { memi: { capture: { mode: "expo-go" } } },
            },
          }),
        },
        { path: "app/index.tsx", content: "export default 1" },
        {
          path: "modules/native-bridge/package.json",
          content: JSON.stringify({
            name: "native-bridge",
            private: true,
            main: "src/index.ts",
            types: "src/index.ts",
          }),
        },
        {
          path: "modules/native-bridge/src/index.ts",
          content: "export const bridge = true",
        },
      ]),
    );

    expect(result.applications).toHaveLength(1);
    expect(result.applications[0]?.platform).toBe("expo-ios");
    expect(result.errors).toEqual([]);
  });

  it("returns actionable diagnostics instead of claiming unknown apps", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "package.json",
          content: JSON.stringify({
            name: "service",
            scripts: { start: "node server.js" },
          }),
        },
        { path: "server.js", content: "console.log('service')" },
      ]),
    );

    expect(result.applications).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "unsupported-application",
        retryable: false,
        path: "package.json",
        remediation: expect.stringMatching(/Expo Router|React web|SwiftUI/),
      }),
    ]);
  });

  it("marks SwiftUI applications without a shared scheme unsupported", () => {
    const result = discoverCaptureApplications(
      manifest([
        {
          path: "ios/App.xcodeproj/project.pbxproj",
          content: "// project",
        },
        { path: "ios/AppApp.swift", content: "@main struct AppApp: App {}" },
        { path: "ios/HomeView.swift", content: "struct HomeView: View {}" },
      ]),
    );

    expect(result.applications[0]).toMatchObject({
      platform: "swiftui",
      status: "unsupported",
      buildRecipe: null,
      errors: [
        expect.objectContaining({
          code: "swiftui-shared-scheme-required",
          retryable: true,
          remediation: expect.stringMatching(/shared scheme/i),
        }),
      ],
    });
  });

  it("enforces manifest budgets and safe relative paths", () => {
    expect(() =>
      discoverCaptureApplications({
        ...manifest([{ path: "../package.json", content: "{}" }]),
      }),
    ).toThrow(/contained relative path/i);

    expect(() =>
      discoverCaptureApplications({
        ...manifest([{ path: "package.json", content: "x".repeat(16) }]),
        budgets: { ...budgets, maxFileBytes: 8 },
      }),
    ).toThrow(/file byte budget/i);

    expect(() =>
      discoverCaptureApplications({
        ...manifest([
          { path: "one", content: "1" },
          { path: "two", content: "2" },
        ]),
        budgets: { ...budgets, maxEntries: 1 },
      }),
    ).toThrow(/entry budget/i);

    expect(() =>
      discoverCaptureApplications({
        ...manifest([
          { path: "one", content: "1234" },
          { path: "two", content: "5678" },
        ]),
        budgets: { ...budgets, maxTotalBytes: 7 },
      }),
    ).toThrow(/total byte budget/i);

    expect(() =>
      discoverCaptureApplications(
        manifest([
          { path: "duplicate", content: "1" },
          { path: "duplicate", content: "2" },
        ]),
      ),
    ).toThrow(/duplicate/i);
  });

  it("rejects malformed package manifests with a precise error", () => {
    const result = discoverCaptureApplications(
      manifest([{ path: "package.json", content: "{nope" }]),
    );

    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "invalid-package-manifest",
        path: "package.json",
        retryable: true,
      }),
    ]);
  });

});
