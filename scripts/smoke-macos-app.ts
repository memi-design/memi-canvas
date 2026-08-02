import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_PATH = resolve(
  "apps/macos/src-tauri/target/debug/bundle/macos/Memi Canvas.app",
);
const EXECUTABLE_PATH = resolve(
  APP_PATH,
  "Contents/MacOS/memi-canvas-macos",
);
const MAX_ATTEMPTS = 80;
const WINDOW_PROBE = `
import CoreGraphics
let windows = CGWindowListCopyWindowInfo(
  [.optionAll],
  kCGNullWindowID
) as? [[String: Any]] ?? []
let matches = windows.filter { window in
  let owner = window[kCGWindowOwnerName as String] as? String
  let title = window[kCGWindowName as String] as? String
  let layer = window[kCGWindowLayer as String] as? Int
  return owner == "Memi Canvas" && title == "Memi Canvas" && layer == 0
}
print(matches.count)
`;

async function processIsRunning(): Promise<boolean> {
  try {
    await execFileAsync("pgrep", ["-f", EXECUTABLE_PATH]);
    return true;
  } catch {
    return false;
  }
}

async function exactProcessIds(): Promise<readonly number[]> {
  try {
    const { stdout } = await execFileAsync("pgrep", [
      "-f",
      EXECUTABLE_PATH,
    ]);
    const candidates = stdout
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isSafeInteger);
    const matches = await Promise.all(
      candidates.map(async (pid) => {
        const { stdout: command } = await execFileAsync("ps", [
          "-p",
          String(pid),
          "-o",
          "command=",
        ]);
        return command.trim() === EXECUTABLE_PATH ? pid : null;
      }),
    );
    return matches.filter((pid): pid is number => pid !== null);
  } catch {
    return [];
  }
}

async function waitForProcess(expected: boolean): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if ((await processIsRunning()) === expected) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(
    expected
      ? "Packaged Memi Canvas process did not launch."
      : "Previous Memi Canvas process did not exit.",
  );
}

async function quitApp(): Promise<void> {
  await execFileAsync("osascript", [
    "-e",
    'tell application "Memi Canvas" to quit',
  ], { timeout: 3_000 }).catch(() => undefined);
  for (const pid of await exactProcessIds()) {
    process.kill(pid, "SIGTERM");
  }
  await waitForProcess(false);
}

async function waitForWindow(): Promise<number> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { stdout } = await execFileAsync("swift", [
      "-e",
      WINDOW_PROBE,
    ]).catch(() => ({ stdout: "0" }));
    const windowCount = Number(stdout.trim());
    if (Number.isSafeInteger(windowCount) && windowCount > 0) {
      return windowCount;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Packaged Memi Canvas launched without a native window.");
}

await access(EXECUTABLE_PATH);
await quitApp();
await execFileAsync("open", ["-n", APP_PATH]);
await waitForProcess(true);

let windowCount: number;
try {
  windowCount = await waitForWindow();
} finally {
  await quitApp();
}
process.stdout.write(
  `${JSON.stringify({
    appPath: APP_PATH,
    executablePath: EXECUTABLE_PATH,
    windowCount,
    renderedTitle: "Memi Canvas",
  })}\n`,
);
