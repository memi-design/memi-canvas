const INTERNAL_SOURCE_HOST = "repository";

export function isSafeReferenceSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol === "memi-source:" &&
      url.hostname === INTERNAL_SOURCE_HOST &&
      url.username === "" &&
      url.password === ""
    ) {
      return true;
    }
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function assertSafeReferenceSourceUrl(value: string): string {
  if (!isSafeReferenceSourceUrl(value)) {
    throw new Error(
      "Reference evidence must use an internal source identity or an explicit loopback URL.",
    );
  }
  return value;
}
