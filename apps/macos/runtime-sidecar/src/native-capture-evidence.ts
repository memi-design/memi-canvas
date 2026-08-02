import { createHash } from "node:crypto";
import {
  constants,
  createReadStream,
  type Stats,
} from "node:fs";
import {
  open,
  realpath,
} from "node:fs/promises";
import { dirname } from "node:path";

import type { SwiftUIXCUITestEvidence } from "@memi/capture-execution";

import { isContained } from "./native-capture-process.js";

export interface SimulatorSelection {
  readonly deviceId: string;
  readonly name: string;
  readonly runtime: string;
}

export async function readBoundedFile(
  path: string,
  root: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const canonicalParent = await realpath(dirname(path));
  if (!isContained(root, canonicalParent)) {
    throw new Error("Native evidence path escapes app data.");
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const metadata: Stats = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new Error("Native evidence exceeds its byte limit.");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function hashExecutable(
  path: string,
): Promise<`sha256:${string}`> {
  const digest = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  return `sha256:${digest.digest("hex")}`;
}

export function hashValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function parseSimulatorSelectionForStates(
  bytes: Uint8Array,
  states: readonly string[],
  unavailableMessage: string,
): SimulatorSelection {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly devices?: Readonly<
      Record<string, readonly Readonly<{
        name?: unknown;
        udid?: unknown;
        state?: unknown;
        isAvailable?: unknown;
        deviceTypeIdentifier?: unknown;
      }>[]>
    >;
  };
  const selected = Object.entries(parsed.devices ?? {})
    .flatMap(([runtime, devices]) =>
      devices.map((device) => ({ runtime, ...device })))
    .filter((device) =>
      states.includes(String(device.state)) &&
      device.isAvailable === true &&
      typeof device.name === "string" &&
      (typeof device.deviceTypeIdentifier === "string"
        ? device.deviceTypeIdentifier.startsWith(
            "com.apple.CoreSimulator.SimDeviceType.iPhone-",
          )
        : /\biPhone\b/u.test(device.name)) &&
      typeof device.udid === "string" &&
      /^[A-Za-z0-9-]{1,80}$/u.test(device.udid))
    .sort((left, right) =>
      String(left.name).localeCompare(String(right.name)))[0];
  if (
    selected === undefined ||
    typeof selected.name !== "string" ||
    typeof selected.udid !== "string"
  ) {
    throw new Error(unavailableMessage);
  }
  return Object.freeze({
    deviceId: selected.udid,
    name: selected.name,
    runtime: selected.runtime,
  });
}

export function parseSimulatorSelection(
  bytes: Uint8Array,
): SimulatorSelection {
  return parseSimulatorSelectionForStates(
    bytes,
    ["Booted"],
    "No booted available iPhone simulator was found.",
  );
}

/**
 * The development-client adapter may boot an existing user simulator only
 * after the import action has been approved. It deliberately never creates,
 * erases, or deletes a caller-owned device.
 */
export function parseBootableSimulatorSelection(
  bytes: Uint8Array,
): SimulatorSelection {
  return parseSimulatorSelectionForStates(
    bytes,
    ["Booted", "Shutdown"],
    "No available iPhone simulator was found.",
  );
}

type EvidenceEnvelope = Omit<
  SwiftUIXCUITestEvidence,
  "hierarchy" | "geometry"
> & {
  readonly hierarchyPath: string;
  readonly geometryPath: string;
};

export function validateEvidenceEnvelope(value: unknown): EvidenceEnvelope {
  if (value === null || typeof value !== "object") {
    throw new Error("XCUITest evidence envelope is invalid.");
  }
  const record = value as Record<string, unknown>;
  const sourceAnchor = record.sourceAnchor;
  const validSourceAnchor =
    sourceAnchor === null ||
    (
      sourceAnchor !== undefined &&
      typeof sourceAnchor === "object" &&
      typeof (sourceAnchor as Record<string, unknown>).relativePath ===
        "string" &&
      (
        (sourceAnchor as Record<string, unknown>).symbol === null ||
        typeof (sourceAnchor as Record<string, unknown>).symbol === "string"
      ) &&
      typeof (sourceAnchor as Record<string, unknown>).contentHash ===
        "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(
        String((sourceAnchor as Record<string, unknown>).contentHash),
      )
    );
  const booleans = [
    "readinessMatched",
    "blank",
    "splash",
    "errorBoundary",
  ];
  if (
    booleans.some((key) => typeof record[key] !== "boolean") ||
    typeof record.route !== "string" ||
    typeof record.state !== "string" ||
    typeof record.hierarchyPath !== "string" ||
    typeof record.geometryPath !== "string" ||
    !validSourceAnchor
  ) {
    throw new Error("XCUITest evidence envelope is invalid.");
  }
  return record as unknown as EvidenceEnvelope;
}
