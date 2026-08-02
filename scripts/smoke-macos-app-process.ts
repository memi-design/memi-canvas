export interface ProcessRow {
  readonly pid: number;
  readonly parentPid: number;
  readonly command: string;
}

export function macOsProcessListArguments(): readonly string[] {
  // BSD ps otherwise truncates long command lines at its display width. The
  // app bundle paths are intentionally long and must be compared in full.
  return ["-ww", "-axo", "pid=,ppid=,command="];
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
