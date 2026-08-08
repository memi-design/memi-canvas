import { describe, expect, it } from "vitest";

import { expoRuntimeSemanticModule } from "./expo-runtime-semantic-module.js";

describe("Expo runtime semantic module", () => {
  it("refreshes capture sessions from every native deep-link event", () => {
    const module = expoRuntimeSemanticModule("revision-1");

    expect(module).toContain('Linking.addEventListener("url"');
    expect(module).toContain("captureSessionFromUrl(event.url)");
    expect(module).toContain("Linking.getInitialURL()");
    expect(module).toContain("setSession(fromUrl)");
  });
});
