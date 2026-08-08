import { describe, expect, it } from "vitest";

import { expoRuntimeSemanticModule } from "./expo-runtime-semantic-module.js";

describe("Expo runtime semantic module", () => {
  it("refreshes capture sessions from every native deep-link event", () => {
    const module = expoRuntimeSemanticModule(
      "revision-1",
      "0123456789ABCDEF0123456789ABCDEF",
    );

    expect(module).toContain('Linking.addEventListener("url"');
    expect(module).toContain("captureSessionFromUrl(event.url)");
    expect(module).toContain("Linking.getInitialURL()");
    expect(module).toContain("setSession(fromUrl)");
    expect(module).toContain("expectedRoute: url.pathname");
    expect(module).toContain("pathname !== session.expectedRoute");
  });

  it("freezes continuous React Native loops in the managed capture runtime", () => {
    const module = expoRuntimeSemanticModule(
      "revision-1",
      "0123456789ABCDEF0123456789ABCDEF",
    );

    expect(module).toContain("const memiAnimatedLoop = Animated.loop");
    expect(module).toContain("iterations: 0");
    expect(module).toContain("Animated.loop =");
  });
});
