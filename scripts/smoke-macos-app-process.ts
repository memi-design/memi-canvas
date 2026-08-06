import { realpath } from "node:fs/promises";

export interface ProcessRow {
  readonly pid: number;
  readonly parentPid: number;
  readonly command: string;
}

export async function canonicalizeMacOsAppPath(appPath: string): Promise<string> {
  return await realpath(appPath);
}

export function macOsProcessListArguments(): readonly string[] {
  // BSD ps otherwise truncates long command lines at its display width. The
  // app bundle paths are intentionally long and must be compared in full.
  return ["-ww", "-axo", "pid=,ppid=,command="];
}

function swiftWindowTargetPid(appProcessId: number): string {
  if (!Number.isSafeInteger(appProcessId) || appProcessId < 1) {
    throw new Error("The spawned macOS app PID is invalid.");
  }
  return String(appProcessId);
}

function swiftWindowPredicates(): string {
  return `
func ownerPid(_ window: [String: Any]) -> Int {
  (window[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1
}
func layer(_ window: [String: Any]) -> Int {
  (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
}
func alpha(_ window: [String: Any]) -> Double {
  (window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0
}
func dimensions(_ window: [String: Any]) -> (width: Double, height: Double) {
  let bounds = window[kCGWindowBounds as String] as? NSDictionary
  return (
    (bounds?["Width"] as? NSNumber)?.doubleValue ?? 0,
    (bounds?["Height"] as? NSNumber)?.doubleValue ?? 0
  )
}
func isVisibleAppWindow(_ window: [String: Any], targetPid: Int) -> Bool {
  let size = dimensions(window)
  return ownerPid(window) == targetPid && layer(window) == 0 &&
    alpha(window) > 0 && size.width > 0 && size.height > 0
}
`;
}

export function macOsVisibleWindowProbe(appProcessId: number): string {
  const targetPid = swiftWindowTargetPid(appProcessId);
  return `
import CoreGraphics
import Foundation
let targetPid = ${targetPid}
let windows = CGWindowListCopyWindowInfo(
  [.optionAll],
  kCGNullWindowID
) as? [[String: Any]] ?? []
${swiftWindowPredicates()}
print(windows.filter { isVisibleAppWindow($0, targetPid: targetPid) }.count)
`;
}

export function macOsWindowDiagnosticProbe(appProcessId: number): string {
  const targetPid = swiftWindowTargetPid(appProcessId);
  return `
import CoreGraphics
import Foundation
let targetPid = ${targetPid}
let windows = CGWindowListCopyWindowInfo(
  [.optionAll],
  kCGNullWindowID
) as? [[String: Any]] ?? []
${swiftWindowPredicates()}
let appWindows = windows.filter { ownerPid($0) == targetPid }
let visibleWindows = appWindows.filter { isVisibleAppWindow($0, targetPid: targetPid) }
let samples = appWindows.prefix(3).map { window -> String in
  let size = dimensions(window)
  let number = (window[kCGWindowNumber as String] as? NSNumber)?.intValue ?? -1
  return "\\(number),\\(layer(window)),\\(alpha(window)),\\(size.width)x\\(size.height)"
}
print("appWindows=\\(appWindows.count) visibleWindows=\\(visibleWindows.count) samples=\\(samples.joined(separator: ";"))")
`;
}

function isPackagedRuntimeCommand(
  command: string,
  runtimeBunPath: string,
  runtimeEntryPath: string,
): boolean {
  const launcherResourcePath = (path: string): string =>
    path.replace(
      "/Contents/Resources/",
      "/Contents/MacOS/../Resources/",
    );
  // The signed shell launcher derives Resources from Contents/MacOS and its
  // exec argv preserves that single lexical spelling. Treat only that known
  // pair as equivalent; do not normalize arbitrary dot-dot paths.
  const allowedCommands = [
    `${runtimeBunPath} ${runtimeEntryPath}`,
    `${launcherResourcePath(runtimeBunPath)} ${launcherResourcePath(runtimeEntryPath)}`,
  ];
  return allowedCommands.some(
    (allowedCommand) =>
      command === allowedCommand || command.startsWith(`${allowedCommand} `),
  );
}

export function findPackagedRuntimeSidecar(
  rows: readonly ProcessRow[],
  appProcessId: number,
  runtimeBunPath: string,
  runtimeEntryPath: string,
): ProcessRow | undefined {
  return rows.find(
    (row) =>
      row.parentPid === appProcessId &&
      isPackagedRuntimeCommand(row.command, runtimeBunPath, runtimeEntryPath),
  );
}

export function formatDirectChildDiagnostic(
  rows: readonly ProcessRow[],
  appProcessId: number,
): string {
  const directChildren = rows
    .filter((row) => row.parentPid === appProcessId)
    .map((row) => `${row.pid}:${row.command}`)
    .join(" | ");
  return directChildren.length === 0
    ? "directChildren=none"
    : `directChildren=${directChildren.slice(0, 1_000)}`;
}
