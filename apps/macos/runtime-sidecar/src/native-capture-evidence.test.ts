import { describe, expect, it } from "vitest";

import {
  parseBootableSimulatorSelection,
  parseSimulatorSelection,
} from "./native-capture-evidence.js";

describe("parseSimulatorSelection", () => {
  it("accepts a booted custom-named iPhone simulator by device type", () => {
    const selection = parseSimulatorSelection(new TextEncoder().encode(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{
            name: "Memi V12 iPhone 17",
            udid: "FED7FB9E-13D5-4383-93EA-7FFE0111A496",
            state: "Booted",
            isAvailable: true,
            deviceTypeIdentifier:
              "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
          }],
        },
      }),
    ));

    expect(selection).toEqual({
      deviceId: "FED7FB9E-13D5-4383-93EA-7FFE0111A496",
      name: "Memi V12 iPhone 17",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
    });
  });

  it("selects an available shutdown iPhone for an approved development-client launch", () => {
    const selection = parseBootableSimulatorSelection(new TextEncoder().encode(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{
            name: "iPhone 17",
            udid: "0E62D301-F419-4EBE-9C25-0BD5D7086B6E",
            state: "Shutdown",
            isAvailable: true,
            deviceTypeIdentifier:
              "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
          }],
        },
      }),
    ));

    expect(selection).toMatchObject({
      deviceId: "0E62D301-F419-4EBE-9C25-0BD5D7086B6E",
      name: "iPhone 17",
    });
  });
});
