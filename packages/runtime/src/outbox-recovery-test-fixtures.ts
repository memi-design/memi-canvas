import { DatabaseSync } from "node:sqlite";

import type { DurableCommand } from "../../protocol/src/index.js";

export function rewriteClaimedIntentAsLegacyProcess(
  databasePath: string,
  command: DurableCommand,
): void {
  const database = new DatabaseSync(databasePath);
  try {
    const row = database
      .prepare(
        `SELECT record_json
         FROM outbox
         WHERE command_id = ?`,
      )
      .get(command.id) as
      | { readonly record_json: string }
      | undefined;
    if (row === undefined) {
      throw new Error("Claimed intent is missing its outbox record.");
    }
    const outbox = JSON.parse(row.record_json) as {
      readonly effect: Record<string, unknown>;
      readonly [key: string]: unknown;
    };
    const legacyOutbox = {
      ...outbox,
      actionDigest: command.actionDigest,
      effect: {
        kind: command.kind,
        targetId: command.target.id,
        expectedBeforeHash: command.target.expectedBeforeHash,
        payloadHash: command.payloadHash,
      },
    };

    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          `UPDATE commands
           SET target_kind = ?, target_id = ?,
               action_digest = ?, command_json = ?
           WHERE id = ?`,
        )
        .run(
          command.target.kind,
          command.target.id,
          command.actionDigest,
          JSON.stringify(command),
          command.id,
        );
      database
        .prepare(
          `UPDATE outbox
           SET target_kind = ?, target_id = ?, record_json = ?
           WHERE command_id = ?`,
        )
        .run(
          command.target.kind,
          command.target.id,
          JSON.stringify(legacyOutbox),
          command.id,
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  } finally {
    database.close();
  }
}
