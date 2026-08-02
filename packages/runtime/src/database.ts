import { DatabaseSync } from "node:sqlite";

import {
  AUTHORITATIVE_TABLES,
  RUNTIME_SCHEMA,
  canonicalEffectReceiptsTableSchema,
  commandsTableSchema,
  commandsTableSchemaV2,
  harnessLifecycleSchema,
  leasesTableSchema,
  outboxTableSchema,
  recoveryDecisionsTableSchema,
  targetReceiptsTableSchema,
  targetRecoveryEvidenceTableSchema,
  targetScheduleLatchesTableSchema,
  targetVerificationAttemptsTableSchema,
  traceEffectBindingsTableSchema,
  traceAuthorityIndexesSchema,
  traceEventsTableSchema,
  traceHeadsTableSchema,
  traceProjectionOutboxTableSchema,
} from "./schema.js";
import { trustedAuthoritySchema } from "./trusted-authority-schema.js";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export class RuntimeDatabase {
  static readonly schemaVersion = 11;
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path, {
      allowExtension: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      timeout: 5_000,
    });
    try {
      this.raw.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = FULL;
        PRAGMA trusted_schema = OFF;
      `);
      const version = this.pragmaNumber("user_version");
      if (version === 0) {
        const tables = this.raw
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
          )
          .all();
        if (tables.length > 0) {
          throw new Error(
            "Unversioned runtime database contains incompatible tables.",
          );
        }
        this.raw.exec("PRAGMA journal_mode = WAL");
        this.transaction(() => {
          this.raw.exec(RUNTIME_SCHEMA);
          this.raw.exec(
            `PRAGMA user_version = ${RuntimeDatabase.schemaVersion}`,
          );
        });
      } else if (version === 1) {
        this.migrateVersionOne();
        this.migrateVersionTwo();
        this.migrateVersionThree();
        this.migrateVersionFour();
        this.migrateVersionFive();
        this.migrateVersionSix();
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 2) {
        this.migrateVersionTwo();
        this.migrateVersionThree();
        this.migrateVersionFour();
        this.migrateVersionFive();
        this.migrateVersionSix();
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 3) {
        this.migrateVersionThree();
        this.migrateVersionFour();
        this.migrateVersionFive();
        this.migrateVersionSix();
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 4) {
        this.migrateVersionFour();
        this.migrateVersionFive();
        this.migrateVersionSix();
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 5) {
        this.migrateVersionFive();
        this.migrateVersionSix();
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 6) {
        this.migrateVersionSix();
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 7) {
        this.migrateVersionSeven();
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 8) {
        this.migrateVersionEight();
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 9) {
        this.migrateVersionNine();
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version === 10) {
        this.migrateVersionTen();
        this.raw.exec("PRAGMA journal_mode = WAL");
      } else if (version !== RuntimeDatabase.schemaVersion) {
        throw new Error(
          `Unsupported runtime schema version ${version}; expected ${RuntimeDatabase.schemaVersion}.`,
        );
      } else {
        this.raw.exec("PRAGMA journal_mode = WAL");
      }
      this.validateCompatibility();
    } catch (error) {
      this.raw.close();
      throw new Error(
        `Runtime database schema initialization failed: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
        { cause: error },
      );
    }
  }

  transaction<T>(operation: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  one(sql: string, ...values: readonly SqlValue[]): SqlRow | undefined {
    return this.raw.prepare(sql).get(...values) as SqlRow | undefined;
  }

  all(sql: string, ...values: readonly SqlValue[]): readonly SqlRow[] {
    return this.raw.prepare(sql).all(...values) as SqlRow[];
  }

  run(sql: string, ...values: readonly SqlValue[]): number {
    return Number(this.raw.prepare(sql).run(...values).changes);
  }

  close(): void {
    this.raw.close();
  }

  inspect() {
    const journal = this.raw.prepare("PRAGMA journal_mode").get() as
      | Record<string, SqlValue>
      | undefined;
    return {
      schemaVersion: this.pragmaNumber("user_version"),
      journalMode: String(journal?.journal_mode),
      foreignKeys: this.pragmaNumber("foreign_keys") === 1,
      synchronous:
        this.pragmaNumber("synchronous") === 2 ? "full" : "unknown",
      trustedSchema: this.pragmaNumber("trusted_schema") === 1,
      extensionsEnabled: false,
      busyTimeoutMilliseconds: this.pragmaNumber("busy_timeout"),
      strictTables: [...AUTHORITATIVE_TABLES],
    };
  }

  pragmaNumber(name: string): number {
    const row = this.raw.prepare(`PRAGMA ${name}`).get() as
      | Record<string, SqlValue>
      | undefined;
    return Number(
      row?.[name] ??
        (row === undefined ? undefined : Object.values(row)[0]),
    );
  }

  private validateCompatibility(): void {
    const pragmasAreSafe =
      this.pragmaNumber("user_version") ===
        RuntimeDatabase.schemaVersion &&
      this.pragmaNumber("foreign_keys") === 1 &&
      this.pragmaNumber("synchronous") === 2 &&
      this.pragmaNumber("trusted_schema") === 0 &&
      this.pragmaNumber("busy_timeout") >= 5_000;
    const journal = this.raw.prepare("PRAGMA journal_mode").get() as
      | Record<string, SqlValue>
      | undefined;
    if (
      !pragmasAreSafe ||
      String(journal?.journal_mode).toLowerCase() !== "wal"
    ) {
      throw new Error(
        "Runtime database safety pragmas are incompatible.",
      );
    }

    const tableRows = this.raw
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as readonly Record<string, SqlValue>[];
    const tableNames = tableRows
      .map((row) => String(row.name))
      .sort();
    const requiredNames = [...AUTHORITATIVE_TABLES].sort();
    if (JSON.stringify(tableNames) !== JSON.stringify(requiredNames)) {
      throw new Error(
        "Runtime database authoritative table set is incompatible.",
      );
    }
    if (
      tableRows.some(
        (row) => !/\bSTRICT\s*;?\s*$/iu.test(String(row.sql)),
      )
    ) {
      throw new Error(
        "Runtime database requires STRICT authoritative tables.",
      );
    }
    this.validateTraceAuthoritySchemas(tableRows);
    this.validateHarnessAuthoritySchemas();
    const jsonFeature = this.raw
      .prepare("SELECT json_valid('{}') AS supported")
      .get() as Record<string, SqlValue>;
    if (Number(jsonFeature.supported) !== 1) {
      throw new Error("Runtime database requires SQLite JSON support.");
    }
  }

  private migrateVersionOne(): void {
    this.raw.exec("PRAGMA foreign_keys = OFF");
    try {
      this.transaction(() => {
        this.raw.exec(commandsTableSchemaV2("commands_v2"));
        this.raw.exec(`
          INSERT INTO commands_v2 (
            id, project_id, idempotency_key, action_digest, grant_id,
            approval_id, state, command_json, effect_payload_json
          )
          SELECT
            id, project_id, idempotency_key, action_digest, grant_id,
            approval_id, state, command_json, effect_payload_json
          FROM commands
        `);
        this.raw.exec(
          recoveryDecisionsTableSchema("recovery_decisions_v2"),
        );
        this.raw.exec(`
          INSERT INTO recovery_decisions_v2 (
            sequence, id, command_id, decision_json
          )
          SELECT rowid, id, command_id, decision_json
          FROM recovery_decisions
          ORDER BY rowid
        `);
        this.raw.exec(`
          DROP TABLE recovery_decisions;
          DROP TABLE commands;
          ALTER TABLE commands_v2 RENAME TO commands;
          ALTER TABLE recovery_decisions_v2
            RENAME TO recovery_decisions;
          PRAGMA user_version = 2;
        `);
        this.assertForeignKeyIntegrity();
      });
    } finally {
      this.raw.exec("PRAGMA foreign_keys = ON");
    }
  }

  private migrateVersionTwo(): void {
    this.raw.exec("PRAGMA foreign_keys = OFF");
    try {
      this.transaction(() => {
        this.raw.exec(commandsTableSchema("commands_v3"));
        this.raw.exec(`
          INSERT INTO commands_v3 (
            id, project_id, target_kind, target_id, idempotency_key,
            action_digest, grant_id, approval_id, state, command_json,
            effect_payload_json
          )
          SELECT
            id,
            project_id,
            json_extract(command_json, '$.target.kind'),
            json_extract(command_json, '$.target.id'),
            idempotency_key,
            action_digest,
            grant_id,
            approval_id,
            state,
            command_json,
            effect_payload_json
          FROM commands
        `);
        this.raw.exec(outboxTableSchema("outbox_v3"));
        this.raw.exec(`
          INSERT INTO outbox_v3 (
            id, command_id, project_id, target_kind, target_id, phase,
            record_json, worker_id, claim_epoch, claim_expires_at
          )
          SELECT
            outbox.id,
            outbox.command_id,
            commands_v3.project_id,
            commands_v3.target_kind,
            commands_v3.target_id,
            outbox.phase,
            outbox.record_json,
            outbox.worker_id,
            outbox.claim_epoch,
            outbox.claim_expires_at
          FROM outbox
          JOIN commands_v3 ON commands_v3.id = outbox.command_id
        `);
        this.raw.exec(`
          DROP TABLE outbox;
          DROP TABLE commands;
          ALTER TABLE commands_v3 RENAME TO commands;
          ALTER TABLE outbox_v3 RENAME TO outbox;
        `);
        this.raw.exec(targetReceiptsTableSchema());
        this.raw.exec(targetScheduleLatchesTableSchema());
        this.raw.exec(`
          INSERT INTO target_schedule_latches (
            project_id, target_kind, target_id, command_id, outbox_id,
            state, worker_claim_id, claim_epoch, acquired_at, updated_at
          )
          SELECT
            project_id,
            target_kind,
            target_id,
            command_id,
            id,
            'blocked-unknown',
            CASE
              WHEN worker_id IS NULL THEN NULL
              ELSE id || ':' || CAST(claim_epoch AS TEXT)
            END,
            claim_epoch,
            json_extract(record_json, '$.createdAt'),
            COALESCE(
              json_extract(record_json, '$.appliedAt'),
              json_extract(record_json, '$.failedAt'),
              json_extract(record_json, '$.createdAt')
            )
          FROM outbox
          WHERE phase = 'effect-applied'
             OR worker_id IS NOT NULL
             OR (
               phase = 'failed'
               AND json_extract(record_json, '$.error.code') =
                 'OUTCOME_UNKNOWN'
             )
        `);
        this.raw.exec("PRAGMA user_version = 3");
        this.assertForeignKeyIntegrity();
      });
    } finally {
      this.raw.exec("PRAGMA foreign_keys = ON");
    }
  }

  private migrateVersionThree(): void {
    this.raw.exec("PRAGMA foreign_keys = OFF");
    try {
      this.transaction(() => {
        this.raw.exec(leasesTableSchema("leases_v4"));
        this.raw.exec(`
          INSERT INTO leases_v4 (
            id, project_id, target_id, holder_id, fencing_epoch, phase,
            acquired_at, expires_at, target_activated_at, activated_at,
            activation_json, lease_json
          )
          SELECT
            id, project_id, target_id, holder_id, fencing_epoch,
            'pending-fence', acquired_at, expires_at, NULL, NULL, NULL,
            lease_json
          FROM leases
        `);
        this.raw.exec(`
          DROP TABLE leases;
          ALTER TABLE leases_v4 RENAME TO leases;
          PRAGMA user_version = 4;
        `);
        this.assertForeignKeyIntegrity();
      });
    } finally {
      this.raw.exec("PRAGMA foreign_keys = ON");
    }
  }

  private migrateVersionFour(): void {
    this.raw.exec("PRAGMA foreign_keys = OFF");
    try {
      this.transaction(() => {
        this.raw.exec(
          targetScheduleLatchesTableSchema(
            "target_schedule_latches_v5",
          ),
        );
        this.raw.exec(`
          INSERT INTO target_schedule_latches_v5 (
            project_id, target_kind, target_id, command_id, outbox_id,
            state, worker_claim_id, claim_epoch, recovery_json,
            acquired_at, updated_at
          )
          SELECT
            project_id, target_kind, target_id, command_id, outbox_id,
            state, worker_claim_id, claim_epoch, NULL,
            acquired_at, updated_at
          FROM target_schedule_latches
        `);
        this.raw.exec(`
          DROP TABLE target_schedule_latches;
          ALTER TABLE target_schedule_latches_v5
            RENAME TO target_schedule_latches;
          PRAGMA user_version = 5;
        `);
        this.assertForeignKeyIntegrity();
      });
    } finally {
      this.raw.exec("PRAGMA foreign_keys = ON");
    }
  }

  private migrateVersionFive(): void {
    this.transaction(() => {
      this.raw.exec(targetRecoveryEvidenceTableSchema());
      this.raw.exec("PRAGMA user_version = 6");
      this.assertForeignKeyIntegrity();
    });
  }

  private migrateVersionSix(): void {
    this.transaction(() => {
      const legacyEffectCount = Number(
        this.one(
          "SELECT count(*) AS count FROM effect_receipts",
        )?.count,
      );
      const legacyReferenceCount = Number(
        this.one(
          "SELECT count(*) AS count FROM trace_references",
        )?.count,
      );
      const committedOutboxCount = Number(
        this.one(
          `SELECT count(*) AS count FROM outbox
           WHERE phase = 'committed'`,
        )?.count,
      );
      if (
        legacyEffectCount > 0 ||
        legacyReferenceCount > 0 ||
        committedOutboxCount > 0
      ) {
        throw new Error(
          "Runtime v6 legacy commit evidence requires explicit adjudication before schema v7 migration.",
        );
      }
      this.raw.exec(`
        ALTER TABLE effect_receipts
          RENAME TO legacy_effect_receipts;
        ALTER TABLE trace_references
          RENAME TO legacy_trace_references;
      `);
      this.raw.exec(traceEventsTableSchema());
      this.raw.exec(traceHeadsTableSchema());
      this.raw.exec(
        traceEffectBindingsTableSchema(
          "trace_effect_bindings",
          "trace_events",
          null,
        ),
      );
      this.raw.exec(canonicalEffectReceiptsTableSchema());
      this.raw.exec(traceProjectionOutboxTableSchema());
      this.raw.exec(traceAuthorityIndexesSchema());
      this.raw.exec("PRAGMA user_version = 7");
      this.assertForeignKeyIntegrity();
    });
  }

  private migrateVersionSeven(): void {
    this.transaction(() => {
      this.assertNoLegacyCommitContamination("v7");
      for (const table of [
        "effect_receipts",
        "trace_effect_bindings",
        "trace_events",
        "trace_heads",
        "trace_projection_outbox",
      ]) {
        if (
          Number(
            this.one(
              `SELECT count(*) AS count FROM ${table}`,
            )?.count,
          ) > 0
        ) {
          throw new Error(
            "Runtime v7 canonical trace rows require explicit adjudication before schema v8 migration.",
          );
        }
      }
      this.raw.exec(`
        DROP TABLE effect_receipts;
        DROP TABLE trace_effect_bindings;
      `);
      this.raw.exec(
        targetVerificationAttemptsTableSchema(
          "target_verification_attempts",
          false,
        ),
      );
      this.raw.exec(
        traceEffectBindingsTableSchema(
          "trace_effect_bindings",
          "trace_events",
          "target_verification_attempts",
          false,
        ),
      );
      this.raw.exec(canonicalEffectReceiptsTableSchema());
      this.raw.exec(`
        CREATE INDEX trace_effect_bindings_project_event
          ON trace_effect_bindings(
            project_id, event_id, target_kind, target_id
          );
      `);
      this.raw.exec("PRAGMA user_version = 8");
      this.assertForeignKeyIntegrity();
    });
  }

  private migrateVersionEight(): void {
    this.transaction(() => {
      this.assertNoLegacyCommitContamination("v8");
      for (const table of [
        "effect_receipts",
        "trace_effect_bindings",
        "trace_events",
        "trace_heads",
        "trace_projection_outbox",
        "target_verification_attempts",
      ]) {
        if (
          Number(
            this.one(
              `SELECT count(*) AS count FROM ${table}`,
            )?.count,
          ) > 0
        ) {
          throw new Error(
            "Runtime v8 canonical trace rows require explicit adjudication before schema v9 migration.",
          );
        }
      }
      this.raw.exec(`
        DROP TABLE effect_receipts;
        DROP TABLE trace_effect_bindings;
        DROP TABLE target_verification_attempts;
      `);
      this.raw.exec(targetVerificationAttemptsTableSchema());
      this.raw.exec(traceEffectBindingsTableSchema());
      this.raw.exec(canonicalEffectReceiptsTableSchema());
      this.raw.exec(`
        CREATE INDEX trace_effect_bindings_project_event
          ON trace_effect_bindings(
            project_id, event_id, target_kind, target_id
          );
      `);
      this.raw.exec("PRAGMA user_version = 9");
      this.assertForeignKeyIntegrity();
    });
  }

  private migrateVersionNine(): void {
    this.transaction(() => {
      this.raw.exec(trustedAuthoritySchema());
      this.raw.exec("PRAGMA user_version = 10");
      this.assertForeignKeyIntegrity();
    });
  }

  private migrateVersionTen(): void {
    this.transaction(() => {
      this.raw.exec(harnessLifecycleSchema());
      this.raw.exec("PRAGMA user_version = 11");
      this.assertForeignKeyIntegrity();
    });
  }

  private assertNoLegacyCommitContamination(version: string): void {
    const contaminated =
      Number(
        this.one(
          "SELECT count(*) AS count FROM legacy_effect_receipts",
        )?.count,
      ) > 0 ||
      Number(
        this.one(
          "SELECT count(*) AS count FROM legacy_trace_references",
        )?.count,
      ) > 0 ||
      Number(
        this.one(
          `SELECT count(*) AS count FROM outbox
           WHERE phase = 'committed'`,
        )?.count,
      ) > 0 ||
      Number(
        this.one(
          `SELECT count(*) AS count FROM commands
           WHERE state = 'committed'`,
        )?.count,
      ) > 0;
    if (contaminated) {
      throw new Error(
        `Runtime ${version} legacy commit state requires explicit adjudication before canonical schema migration.`,
      );
    }
  }

  private validateTraceAuthoritySchemas(
    tableRows: readonly Record<string, SqlValue>[],
  ): void {
    const normalize = (sql: string) =>
      sql
        .replace(/\s+/gu, " ")
        .replace(/;\s*$/u, "")
        .trim()
        .toLowerCase();
    const actual = new Map(
      tableRows.map((row) => [
        String(row.name),
        normalize(String(row.sql)),
      ]),
    );
    const expected = new Map([
      ["effect_receipts", canonicalEffectReceiptsTableSchema()],
      ["trace_effect_bindings", traceEffectBindingsTableSchema()],
      ["trace_events", traceEventsTableSchema()],
      ["trace_heads", traceHeadsTableSchema()],
      [
        "target_verification_attempts",
        targetVerificationAttemptsTableSchema(),
      ],
      [
        "trace_projection_outbox",
        traceProjectionOutboxTableSchema(),
      ],
    ]);
    for (const [name, sql] of expected) {
      if (actual.get(name) !== normalize(sql)) {
        throw new Error(
          `Runtime database ${name} schema constraints are incompatible.`,
        );
      }
    }
  }

  private validateHarnessAuthoritySchemas(): void {
    const normalize = (sql: string) =>
      sql
        .replace(/\s+/gu, " ")
        .replace(/;\s*$/u, "")
        .trim()
        .toLowerCase();
    const schema = harnessLifecycleSchema();
    const tablePattern =
      /CREATE TABLE\s+([a-z0-9_]+)\s*\([\s\S]*?\n\) STRICT;/giu;
    const expectedTables = new Map<string, string>();
    for (const match of schema.matchAll(tablePattern)) {
      const name = match[1];
      const sql = match[0];
      if (name !== undefined && sql !== undefined) {
        expectedTables.set(name, normalize(sql));
      }
    }
    const actualTableRows = this.raw
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table' AND name LIKE 'harness_%'`,
      )
      .all() as readonly Record<string, SqlValue>[];
    const actualTables = new Map(
      actualTableRows.map((row) => [
        String(row.name),
        normalize(String(row.sql)),
      ]),
    );
    if (
      expectedTables.size !== 6 ||
      expectedTables.size !== actualTables.size ||
      [...expectedTables].some(
        ([name, sql]) => actualTables.get(name) !== sql,
      )
    ) {
      throw new Error(
        "Runtime database harness authority table schema is incompatible.",
      );
    }
    const triggerPattern =
      /CREATE TRIGGER\s+([a-z0-9_]+)[\s\S]*?\bEND;/giu;
    const expected = new Map<string, string>();
    for (const match of schema.matchAll(triggerPattern)) {
      const name = match[1];
      const sql = match[0];
      if (name !== undefined && sql !== undefined) {
        expected.set(name, normalize(sql));
      }
    }
    const actualRows = this.raw
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND name LIKE 'harness_%'`,
      )
      .all() as readonly Record<string, SqlValue>[];
    const actual = new Map(
      actualRows.map((row) => [
        String(row.name),
        normalize(String(row.sql)),
      ]),
    );
    if (
      expected.size === 0 ||
      expected.size !== actual.size ||
      [...expected].some(
        ([name, sql]) => actual.get(name) !== sql,
      )
    ) {
      throw new Error(
        "Runtime database harness authority schema is incompatible.",
      );
    }
  }

  private assertForeignKeyIntegrity(): void {
    const violations = this.raw
      .prepare("PRAGMA foreign_key_check")
      .all();
    if (violations.length > 0) {
      throw new Error(
        "Runtime schema migration produced foreign-key violations.",
      );
    }
  }
}
