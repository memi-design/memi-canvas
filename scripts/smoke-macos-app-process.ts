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
  const packagedBunCommand = `${runtimeBunPath} ${runtimeEntryPath}`;
  return (
    command === packagedBunCommand ||
    command.startsWith(`${packagedBunCommand} `)
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
