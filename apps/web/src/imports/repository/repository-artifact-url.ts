const ARTIFACT_ID = /^art_[0-9A-HJKMNP-TV-Z]{26}$/u;

export function isSafeCaptureArtifactUrl(
  value: string,
  expectedArtifactId: string,
): boolean {
  if (!ARTIFACT_ID.test(expectedArtifactId)) return false;
  if (
    value ===
    `/imports/artifacts/${expectedArtifactId}.png`
  ) {
    return true;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "memi-artifact:" &&
      url.hostname === "localhost" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === `/${expectedArtifactId}`
    );
  } catch {
    return false;
  }
}
