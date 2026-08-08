import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const REQUIRED_AUTH_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
] as const;

interface PilotScenario {
  readonly id: string;
  readonly route: string;
  readonly state: string;
}

function contains(root: string, candidate: string): boolean {
  const local = relative(root, candidate);
  return (
    local === "" ||
    (local !== ".." &&
      !local.startsWith(`..${sep}`) &&
      !isAbsolute(local))
  );
}

function resolvedStorageRoot(
  value: string,
  label: "app data" | "worktree",
): string {
  if (
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.trim() !== value
  ) {
    throw new Error(`Buzzr pilot ${label} root must be an absolute path.`);
  }
  const root = resolve(value);
  if (root === "/") {
    throw new Error(`Buzzr pilot ${label} root may not be the filesystem root.`);
  }
  return root;
}

export function selectBuzzrPilotScenarios<Scenario extends PilotScenario>(
  scenarios: readonly Scenario[],
): readonly Scenario[] {
  const selected = REQUIRED_AUTH_ROUTES.flatMap((route) => {
    const scenario = scenarios.find(
      (candidate) => candidate.route === route && candidate.state === "default",
    );
    return scenario === undefined ? [] : [scenario];
  });
  if (selected.length !== REQUIRED_AUTH_ROUTES.length) {
    const available = new Set(selected.map(({ route }) => route));
    const missing = REQUIRED_AUTH_ROUTES.filter((route) => !available.has(route));
    throw new Error(
      `Buzzr is missing required signed-out pilot routes: ${missing.join(", ")}.`,
    );
  }
  return Object.freeze(selected);
}

export function resolveBuzzrPilotWorktreeRoot(input: Readonly<{
  readonly configuredRoot?: string;
  readonly defaultRoot: string;
  readonly repositoryRoot: string;
}>): string {
  const worktreeRoot = resolvedStorageRoot(
    input.configuredRoot ?? input.defaultRoot,
    "worktree",
  );
  const repositoryRoot = resolve(input.repositoryRoot);
  if (
    contains(repositoryRoot, worktreeRoot) ||
    contains(worktreeRoot, repositoryRoot)
  ) {
    throw new Error(
      "Buzzr pilot worktree root must be disjoint from the source repository.",
    );
  }
  return worktreeRoot;
}

export function resolveBuzzrPilotAppDataRoot(input: Readonly<{
  readonly configuredRoot?: string;
  readonly defaultRoot: string;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
}>): string {
  const appDataRoot = resolvedStorageRoot(
    input.configuredRoot ?? input.defaultRoot,
    "app data",
  );
  const repositoryRoot = resolve(input.repositoryRoot);
  const worktreeRoot = resolve(input.worktreeRoot);
  if (
    contains(repositoryRoot, appDataRoot) ||
    contains(appDataRoot, repositoryRoot) ||
    contains(worktreeRoot, appDataRoot) ||
    contains(appDataRoot, worktreeRoot)
  ) {
    throw new Error(
      "Buzzr pilot app data root must be disjoint from source and worktree storage.",
    );
  }
  return appDataRoot;
}

async function validatedPlanKey(path: string): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Memi's local import-plan authority must be a regular file.");
  }
  const key = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/u.test(key)) {
    throw new Error("Memi's local import-plan authority is invalid.");
  }
  return key;
}

export async function loadOrCreatePilotPlanKey(
  appDataRoot: string,
): Promise<string> {
  const root = resolvedStorageRoot(appDataRoot, "app data");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Buzzr pilot app data root must be a real directory.");
  }
  const runtimeRoot = join(root, "runtime");
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const keyPath = join(runtimeRoot, "plan-integrity-v1.key");
  try {
    return await validatedPlanKey(keyPath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const key = randomBytes(32).toString("hex");
  try {
    const handle = await open(keyPath, "wx", 0o600);
    try {
      await handle.writeFile(key, "utf8");
    } finally {
      await handle.close();
    }
    return key;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return validatedPlanKey(keyPath);
    }
    throw error;
  }
}
