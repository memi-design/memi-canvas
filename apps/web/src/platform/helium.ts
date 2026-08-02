export interface TauriInternals {
  readonly invoke: (
    command: string,
    arguments_: Record<string, unknown>,
  ) => Promise<unknown>;
}

export interface HeliumHost {
  readonly __TAURI_INTERNALS__?: TauriInternals;
}

export type HeliumOpenResult =
  | { readonly status: "opened" }
  | {
      readonly status: "failed" | "rejected" | "unavailable";
      readonly message: string;
    };

function isExplicitLocalPreview(value: string): boolean {
  if (
    !/^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}(?:[/?#]|$)/u.test(
      value,
    )
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    const port = Number.parseInt(url.port, 10);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1") &&
      url.username === "" &&
      url.password === "" &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65_535
    );
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "Memi could not open the local preview in Helium.";
}

export async function openLocalPreviewInHelium(
  url: string,
  host: HeliumHost = globalThis as HeliumHost,
): Promise<HeliumOpenResult> {
  if (!isExplicitLocalPreview(url)) {
    return {
      status: "rejected",
      message:
        "Helium can open only explicit HTTP localhost preview ports.",
    };
  }
  if (host.__TAURI_INTERNALS__ === undefined) {
    return {
      status: "unavailable",
      message: "Open in Helium is available in the Memi macOS app.",
    };
  }
  try {
    await host.__TAURI_INTERNALS__.invoke("open_in_helium", { url });
    return { status: "opened" };
  } catch (error) {
    return { status: "failed", message: errorMessage(error) };
  }
}
