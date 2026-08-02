import type { CanonicalSandboxPaths } from "./paths";

function literal(value: string): string {
  return JSON.stringify(value);
}

function subpathRules(paths: readonly string[]): string {
  return paths.map((path) => `    (subpath ${literal(path)})`).join("\n");
}

export function buildMacOSSandboxProfile(
  paths: CanonicalSandboxPaths,
): string {
  const readableRoots = [
    ...paths.sourceRoots,
    paths.worktreeRoot,
    paths.tempRoot,
  ];

  return `
(version 1)
(deny default)

(allow process-fork)
(allow process-exec
  (literal ${literal(paths.executable)}))
(allow signal
  (target same-sandbox))

(allow file-read*
  (literal "/")
  (literal "/dev/null")
  (literal "/dev/urandom")
  (literal "/System/Library/OpenSSL/openssl.cnf")
  (literal ${literal(paths.executable)})
${subpathRules(readableRoots)})

(allow file-write*
  (literal "/dev/null")
  (subpath ${literal(paths.worktreeRoot)})
  (subpath ${literal(paths.tempRoot)}))
`.trim();
}
