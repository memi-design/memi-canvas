import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const TEST_REPOSITORY = {
  revision: "0123456789abcdef0123456789abcdef01234567",
  dirty: true,
  dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
} as const;

export const TEST_BUDGETS = {
  maxFiles: 128,
  maxEntries: 512,
  maxDepth: 32,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 512 * 1024,
} as const;

const FIXTURE_FILES = {
  "package.json": JSON.stringify({
    name: "expo-router-product",
    private: true,
    dependencies: {
      expo: "~54.0.0",
      "expo-router": "~6.0.0",
      react: "19.1.0",
      "react-native": "0.81.0",
    },
  }),
  "app.config.ts": `
    import { writeFileSync } from "node:fs";
    writeFileSync(process.env.MEMI_IMPORT_SENTINEL!, "executed");
    export default { expo: { name: "must-not-execute" } };
  `,
  "app/_layout.tsx": `
    import { Stack } from "expo-router";
    export default function RootLayout() { return <Stack />; }
  `,
  "app/+html.tsx": `
    export default function HtmlShell() { return null; }
  `,
  "app/+not-found.tsx": `
    export default function NotFound() { return null; }
  `,
  "app/index.tsx": `
    export default function HomeScreen() { return null; }
  `,
  "app/(auth)/sign-in.tsx": `
    export default function SignInScreen() { return null; }
  `,
  "app/(auth)/index.tsx": `
    export default function AuthIndexScreen() { return null; }
  `,
  "app/(protected)/(tabs)/game/[gameId].tsx": `
    export default function GameScreen() { return null; }
  `,
  "app/search/[...query].tsx": `
    export default function SearchScreen() { return null; }
  `,
  "app/team/[league]/[teamId]/index.tsx": `
    export default function TeamScreen() { return null; }
  `,
  "app/api/health+api.ts": `
    export function GET() { return Response.json({ ok: true }); }
  `,
  "components/ui/GameCard.tsx": `
    export function GameCard() { return null; }
  `,
  "components/ui/index.ts": `
    export { GameCard } from "./GameCard";
  `,
  "src/features/games/components/GameRow.tsx": `
    export function GameRow() { return null; }
  `,
  "src/features/games/screens/GamesTabScreen.tsx": `
    import { GameRow } from "../components/GameRow";
    export function GamesTabScreen() { return <GameRow />; }
  `,
  "constants/Colors.ts": `
    export const Colors = { ink: "#111111", paper: "#ffffff" } as const;
  `,
  "src/theme/tokens.ts": `
    export const spacing = { compact: 8, regular: 16 } as const;
  `,
  "src/features/notifications/services/push-token-service.ts": `
    export async function registerPushToken() { return "noop"; }
  `,
  "src/features/theme/services/theme-preferences-service.ts": `
    export function saveThemePreference() { return "dark"; }
  `,
  "node_modules/fake-package/app/poison.tsx": `
    throw new Error("dependency code must not be analyzed as a product route");
  `,
  ".expo/types/router.d.ts": `
    export type GeneratedRoute = "/generated-only";
  `,
} as const;

export interface Fixture {
  readonly root: string;
  readonly sentinel: string;
}

let fixtureRoots: readonly string[] = [];

async function writeFixtureEntry(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const candidate = join(root, path);
  await mkdir(dirname(candidate), { recursive: true });
  await writeFile(candidate, contents, "utf8");
}

export async function createExpoRouterFixture(options?: {
  readonly reverseCreationOrder?: boolean;
  readonly additionalFiles?: Readonly<Record<string, string>>;
}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "memi-expo-router-import-"));
  fixtureRoots = [...fixtureRoots, root];
  const files: Readonly<Record<string, string>> = {
    ...FIXTURE_FILES,
    ...options?.additionalFiles,
  };
  const paths = Object.keys(files).sort();
  const orderedPaths = options?.reverseCreationOrder ? [...paths].reverse() : paths;
  for (const path of orderedPaths) {
    await writeFixtureEntry(root, path, files[path] ?? "");
  }
  return {
    root,
    sentinel: join(root, "project-code-executed"),
  };
}

export async function expectSentinelAbsent(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

export async function cleanupExpoRouterFixtures(): Promise<void> {
  const roots = fixtureRoots;
  fixtureRoots = [];
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
}
