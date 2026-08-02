import type {
  ContentHash,
  DurableCommand,
} from "../../protocol/src/index.js";

import type { SqlRow } from "./database.js";

export interface AcceptedCommand {
  readonly commandId: DurableCommand["id"];
  readonly state: string;
  readonly actionDigest: ContentHash;
}

export interface RecoverySummary {
  readonly intentsAwaitingEffect: readonly string[];
  readonly effectsAwaitingCommit: readonly string[];
  readonly blockedOutcomeUnknown: readonly string[];
}

export function json<T>(value: T): string {
  return JSON.stringify(value);
}

export function parsed<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

export function rowText(row: SqlRow, key: string): string {
  return String(row[key]);
}

export function isBefore(
  timestamp: string,
  boundary: string,
): boolean {
  return Date.parse(timestamp) < Date.parse(boundary);
}
