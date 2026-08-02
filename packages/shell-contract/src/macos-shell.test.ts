import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const MACOS_ROOT = "apps/macos/src-tauri";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("Memi Canvas macOS shell boundary", () => {
  it("loads the exact shared web build without duplicating product logic", async () => {
    const config = await readJson(`${MACOS_ROOT}/tauri.conf.json`);

    expect(config).toMatchObject({
      identifier: "design.memi.canvas",
      productName: "memi Canvas",
      build: {
        devUrl: "http://127.0.0.1:5173",
        frontendDist: "../../../dist/web",
      },
      app: {
        windows: [
          expect.objectContaining({
            label: "main",
            title: "memi Canvas",
          }),
        ],
      },
    });
  });

  it("grants only the user-initiated folder dialog capability", async () => {
    const capability = await readJson(
      `${MACOS_ROOT}/capabilities/default.json`,
    );
    expect(capability).toMatchObject({
      identifier: "main-capability",
      windows: ["main"],
      permissions: ["dialog:allow-open"],
    });
    expect(JSON.stringify(capability)).not.toMatch(
      /shell|execute|spawn|filesystem|fs:/iu,
    );
  });

  it("exposes the authenticated runtime bridge and project-contained app openers", async () => {
    const source = await readFile(`${MACOS_ROOT}/src/lib.rs`, "utf8");

    expect(source).toContain("tauri::Builder::default()");
    expect(source).toContain("open_in_helium");
    expect(source).toContain("localhost");
    expect(source).toContain("127.0.0.1");
    expect(source).toContain('arg("Helium")');
    expect(source).toContain("open_in_vscode");
    expect(source).toContain("open_in_cursor");
    expect(source).toContain("validated_relative_source");
    expect(source).toContain("canonicalize()");
    expect(source).toContain('arg("com.microsoft.VSCode")');
    expect(source).toContain('arg("com.todesktop.230313mzl4w4u92")');
    expect(source).toContain("runtime_session");
    expect(source).toContain("runtime_rpc");
    expect(source).toContain("runtime_artifact");
    expect(source).toContain("reveal_import_logs");
    expect(source).toMatch(
      /\.invoke_handler\(tauri::generate_handler!\[[\s\S]*open_in_helium,[\s\S]*open_in_vscode,[\s\S]*open_in_cursor,[\s\S]*runtime_session,[\s\S]*runtime_rpc,[\s\S]*runtime_artifact,[\s\S]*reveal_import_logs[\s\S]*\]\)/u,
    );
    expect(source).not.toContain("scan_repository");
    expect(source).toContain(".build(tauri::generate_context!())");
    expect(source).toContain("app.run(|app_handle, event|");
    expect(source).toContain("RuntimeBridgeState>().shutdown()");
    expect(source).not.toMatch(/reqwest|\/bin\/(?:ba)?sh|\.arg\("-c"\)/iu);
  });
});
