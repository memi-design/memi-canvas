import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  prepareExpoRuntimeInstrumentation,
  restoreExpoRuntimeInstrumentation,
} from "./expo-runtime-instrumentation.js";

const SOURCE_REVISION = "a6ce2458e0cd1b252663057f2e4060f0929c0687";
const ROOT_LAYOUT = [
  "import 'react-native-gesture-handler';",
  "import { Stack } from 'expo-router';",
  "import { View } from 'react-native';",
  "function RootLayout() { return <View><Stack /></View>; }",
  "export default wrapRootComponent(RootLayout);",
  "",
].join("\n");
const SCREEN = [
  "import { Pressable, Text, View as Surface } from 'react-native';",
  "export default function Screen() {",
  "  return (",
  "    <Surface style={{ flex: 1 }}>",
  "      <Pressable style={{ padding: 12 }}>",
  "        <Text style={{ color: '#fff' }}>Continue</Text>",
  "      </Pressable>",
  "    </Surface>",
  "  );",
  "}",
  "",
].join("\n");

describe("managed Expo runtime instrumentation", () => {
  it("adds reversible semantic runtime instrumentation", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-attestation-"));
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app/_layout.tsx"), ROOT_LAYOUT);
    await writeFile(join(root, "app/index.tsx"), SCREEN);

    const prepared = await prepareExpoRuntimeInstrumentation({
      managedWorktreeRoot: root,
      sourceRevision: SOURCE_REVISION,
    });
    const patched = await readFile(join(root, "app/_layout.tsx"), "utf8");
    const patchedScreen = await readFile(join(root, "app/index.tsx"), "utf8");
    const module = await readFile(prepared.modulePath, "utf8");

    expect(prepared.originalLayoutHash).toMatch(/^sha256:/u);
    expect(prepared.instrumentationHash).toMatch(/^sha256:/u);
    expect(patched).toContain("MemiCaptureRuntimeAttestation");
    expect(patched).toContain("const MemiCaptureOriginalRoot");
    expect(patched.indexOf("import 'react-native-gesture-handler';")).toBeLessThan(
      patched.indexOf("import { MemiCapturePrimitive }"),
    );
    expect(patched.indexOf("import 'react-native-gesture-handler';")).toBeLessThan(
      patched.indexOf("import { MemiCaptureRuntimeAttestation }"),
    );
    expect(module).toContain(SOURCE_REVISION);
    expect(module).toContain("Clipboard.setStringAsync");
    expect(module).toContain("Clipboard.getStringAsync");
    expect(module).toContain("useState");
    expect(module).toContain("sourceRevision !== SOURCE_REVISION");
    expect(module).toContain("usePathname");
    expect(module).toContain("semanticCapture");
    expect(module).toContain("StyleSheet.flatten");
    expect(module).toContain("measureInWindow");
    expect(module).toContain("MemiCapturePrimitive");
    expect(patchedScreen).toContain("MemiCapturePrimitive");
    expect(patchedScreen).toContain("component={Surface}");
    expect(patchedScreen).toContain("component={Pressable}");
    expect(patchedScreen).toContain("component={Text}");
    expect(patchedScreen).toContain("sourceContentHash");
    expect(prepared.instrumentedSourceCount).toBe(2);

    await restoreExpoRuntimeInstrumentation(prepared);
    await expect(
      readFile(join(root, "app/_layout.tsx"), "utf8"),
    ).resolves.toBe(ROOT_LAYOUT);
    await expect(
      readFile(join(root, "app/index.tsx"), "utf8"),
    ).resolves.toBe(SCREEN);
    await expect(lstat(prepared.modulePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is idempotent for the same source revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-attestation-"));
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app/_layout.tsx"), ROOT_LAYOUT);
    await writeFile(join(root, "app/index.tsx"), SCREEN);

    const first = await prepareExpoRuntimeInstrumentation({
      managedWorktreeRoot: root,
      sourceRevision: SOURCE_REVISION,
    });
    const second = await prepareExpoRuntimeInstrumentation({
      managedWorktreeRoot: root,
      sourceRevision: SOURCE_REVISION,
    });

    expect(second).toEqual(first);
    await restoreExpoRuntimeInstrumentation(first);
  });

  it("rejects a symlinked root layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-attestation-"));
    const outside = join(root, "outside.tsx");
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(outside, ROOT_LAYOUT);
    await symlink(outside, join(root, "app/_layout.tsx"));

    await expect(
      prepareExpoRuntimeInstrumentation({
        managedWorktreeRoot: root,
        sourceRevision: SOURCE_REVISION,
      }),
    ).rejects.toThrow(/regular file|symlink/i);
  });

  it("restores transformed sources when root-layout instrumentation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-attestation-"));
    const invalidLayout = [
      "export default function First() { return null; }",
      "export default function Second() { return null; }",
      "",
    ].join("\n");
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app/_layout.tsx"), invalidLayout);
    await writeFile(join(root, "app/index.tsx"), SCREEN);

    await expect(
      prepareExpoRuntimeInstrumentation({
        managedWorktreeRoot: root,
        sourceRevision: SOURCE_REVISION,
      }),
    ).rejects.toThrow(/exactly one default export/i);

    await expect(readFile(join(root, "app/index.tsx"), "utf8")).resolves.toBe(
      SCREEN,
    );
    await expect(
      lstat(join(root, ".memi/capture/runtime-attestation")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
