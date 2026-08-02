import { describe, expect, it } from "vitest";

import {
  createExpoStandaloneDeepLink,
  materializeExpoRoute,
} from "./expo-route-navigation.js";

describe("standalone Expo route navigation", () => {
  it("builds a canonical empty-host deep link for a static route", () => {
    expect(
      createExpoStandaloneDeepLink({
        scheme: "buzzr",
        route: "/profile",
        parameters: [],
      }),
    ).toEqual({
      concreteRoute: "/profile",
      url: "buzzr:///profile",
    });
  });

  it("materializes dynamic and catch-all segments from exact scenario evidence", () => {
    expect(
      materializeExpoRoute("/team/:teamId/files/:path*", [
        { key: "teamId", value: "Boston Celtics" },
        { key: "path", value: "2026/finals notes" },
      ]),
    ).toBe("/team/Boston%20Celtics/files/2026/finals%20notes");
  });

  it("binds a route-state attestation nonce without changing the route", () => {
    expect(
      createExpoStandaloneDeepLink({
        scheme: "buzzr",
        route: "/profile",
        parameters: [],
        attestation: {
          nonce: "01J00000000000000000000000",
          state: "default",
        },
      }),
    ).toEqual({
      concreteRoute: "/profile",
      url:
        "buzzr:///profile?__memi_capture=01J00000000000000000000000&__memi_state=default",
    });
  });

  it.each([
    {
      scheme: "1buzzr",
      route: "/profile",
      parameters: [],
      message: /scheme/i,
    },
    {
      scheme: "buzzr",
      route: "/game/:gameId",
      parameters: [],
      message: /gameId/i,
    },
    {
      scheme: "buzzr",
      route: "/game/:gameId",
      parameters: [
        { key: "gameId", value: "game-1" },
        { key: "unused", value: "not-evidence" },
      ],
      message: /unused/i,
    },
    {
      scheme: "buzzr",
      route: "/game/:gameId",
      parameters: [
        { key: "gameId", value: "game-1" },
        { key: "gameId", value: "game-2" },
      ],
      message: /duplicate/i,
    },
    {
      scheme: "buzzr",
      route: "/game/:gameId",
      parameters: [{ key: "gameId", value: "../settings" }],
      message: /segment/i,
    },
  ])(
    "rejects untrusted deep-link input %#",
    ({ scheme, route, parameters, message }) => {
      expect(() =>
        createExpoStandaloneDeepLink({
          scheme,
          route,
          parameters,
        }),
      ).toThrow(message);
    },
  );
});
