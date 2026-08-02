import { hashCanonicalValue } from "@memi/canonical-json";

import { RuntimeDatabase } from "./database.js";
import {
  harnessRowNumber,
  harnessRowString,
} from "./harness-lifecycle-values.js";
import type { HarnessLifecycleEvent } from "./types.js";

export function auditHarnessLifecycle(
  database: RuntimeDatabase,
): void {
  for (const row of database.all(
    "SELECT run_id FROM harness_runs ORDER BY run_id",
  )) {
    const runId = harnessRowString(row, "run_id");
    let previousHash: string | null = null;
    let expectedSequence = 1;
    const events = database.all(
      `SELECT event_json FROM harness_lifecycle_events
       WHERE run_id = ? ORDER BY sequence`,
      runId,
    );
    for (const eventRow of events) {
      const event = JSON.parse(
        harnessRowString(eventRow, "event_json"),
      ) as HarnessLifecycleEvent;
      const material = {
        runId: event.runId,
        sequence: event.sequence,
        dispatchEpoch: event.dispatchEpoch,
        previousHash: event.previousHash,
        createdAt: event.createdAt,
        signal: event.signal,
      };
      if (
        event.runId !== runId ||
        event.sequence !== expectedSequence ||
        event.previousHash !== previousHash ||
        event.eventHash !== hashCanonicalValue(material)
      ) {
        throw new Error(
          `Harness lifecycle hash chain is corrupt for run "${runId}".`,
        );
      }
      previousHash = event.eventHash;
      expectedSequence += 1;
    }
    const head = database.one(
      `SELECT last_event_sequence, last_event_hash
       FROM harness_runs WHERE run_id = ?`,
      runId,
    );
    if (
      head === undefined ||
      harnessRowNumber(head, "last_event_sequence") !==
        expectedSequence - 1 ||
      (head.last_event_hash === null
        ? null
        : harnessRowString(head, "last_event_hash")) !== previousHash
    ) {
      throw new Error(
        `Harness lifecycle hash chain head is corrupt for run "${runId}".`,
      );
    }
  }
}
