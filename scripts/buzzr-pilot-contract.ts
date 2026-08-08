import { isAbsolute, relative, resolve, sep } from "node:path";

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
  const supplied = input.configuredRoot ?? input.defaultRoot;
  if (
    !isAbsolute(supplied) ||
    supplied.includes("\0") ||
    supplied.trim() !== supplied
  ) {
    throw new Error("Buzzr pilot worktree root must be an absolute path.");
  }
  const worktreeRoot = resolve(supplied);
  const repositoryRoot = resolve(input.repositoryRoot);
  if (
    worktreeRoot === "/" ||
    contains(repositoryRoot, worktreeRoot) ||
    contains(worktreeRoot, repositoryRoot)
  ) {
    throw new Error(
      "Buzzr pilot worktree root must be disjoint from the source repository.",
    );
  }
  return worktreeRoot;
}
