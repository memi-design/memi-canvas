import { describe, expect, it } from "vitest";

import { isSafeCaptureArtifactUrl } from "./repository-artifact-url.js";

const artifactId = "art_01J00000000000000000000000";

describe("repository capture artifact URLs", () => {
  it("accepts only the native localhost scheme or the exact browser fixture route", () => {
    expect(
      isSafeCaptureArtifactUrl(
        `memi-artifact://localhost/${artifactId}`,
        artifactId,
      ),
    ).toBe(true);
    expect(
      isSafeCaptureArtifactUrl(
        `/imports/artifacts/${artifactId}.png`,
        artifactId,
      ),
    ).toBe(true);
  });

  it.each([
    `memi-artifact://evil.example/${artifactId}`,
    `memi-artifact://localhost/${artifactId}?path=/etc/passwd`,
    `memi-artifact://localhost/${artifactId}#other`,
    `memi-artifact://localhost/${artifactId}/child`,
    `memi-artifact://user@localhost/${artifactId}`,
    `memi-artifact://localhost:80/${artifactId}`,
    "memi-artifact://localhost/../imports.sqlite",
    `/imports/artifacts/${artifactId}.png?download=1`,
    "/imports/artifacts/../../imports.sqlite",
    "file:///tmp/capture.png",
    "data:image/png;base64,AAAA",
  ])("rejects hostile or non-authoritative URL %s", (value) => {
    expect(isSafeCaptureArtifactUrl(value, artifactId)).toBe(false);
  });

  it("binds the URL to the expected artifact identity", () => {
    expect(
      isSafeCaptureArtifactUrl(
        "memi-artifact://localhost/art_01J00000000000000000000001",
        artifactId,
      ),
    ).toBe(false);
  });
});
