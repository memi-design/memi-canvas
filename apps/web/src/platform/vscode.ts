import type { HeliumHost } from "./helium.js";

export type VSCodeOpenResult =
  | { readonly status: "opened" }
  | {
      readonly status: "failed" | "rejected" | "unavailable";
      readonly message: string;
    };

function isContainedRelativeSourcePath(value: string): boolean {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    value.length === 0 ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasControlCharacter
  ) {
    return false;
  }
  const parts = value.split("/");
  return parts.every(
    (part) => part.length > 0 && part !== "." && part !== "..",
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "Memi could not open this source in VS Code.";
}

export async function openSourceInVSCode(
  sourcePath: string,
  rootPathOrHost: string | HeliumHost = globalThis as HeliumHost,
  hostArgument?: HeliumHost,
): Promise<VSCodeOpenResult> {
  const rootPath =
    typeof rootPathOrHost === "string" ? rootPathOrHost : undefined;
  const host =
    typeof rootPathOrHost === "string"
      ? hostArgument ?? (globalThis as HeliumHost)
      : rootPathOrHost;
  if (!isContainedRelativeSourcePath(sourcePath)) {
    return {
      status: "rejected",
      message: "VS Code can open only contained project source paths.",
    };
  }
  if (host.__TAURI_INTERNALS__ === undefined) {
    return {
      status: "unavailable",
      message: "Open in VS Code is available in the Memi macOS app.",
    };
  }
  try {
    await host.__TAURI_INTERNALS__.invoke("open_in_vscode", {
      sourcePath,
      ...(rootPath === undefined ? {} : { rootPath }),
    });
    return { status: "opened" };
  } catch (error) {
    return { status: "failed", message: errorMessage(error) };
  }
}
