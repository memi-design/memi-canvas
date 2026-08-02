import { hashCanonicalValue } from "@memi/canonical-json";
import { describe, expect, it } from "vitest";

import {
  parseWorkspaceDocumentation,
  type WorkspaceDocumentation,
} from "./index.js";
import { projectWorkspaceDocumentation } from "./projector.js";
import {
  committedInput,
  mutable,
  recomputeReplayHashes,
  type CanonicalReplay,
  type DocumentationInput,
} from "../test-support.js";

const FOREIGN_PROJECT_ID = "prj_01J00000000000000000000001";
const OUTSIDE_OPERATION_ID = "opn_01J00000000000000000000001";
const OUTSIDE_EVENT_ID = "evt_01J00000000000000000000001";
const OUTSIDE_COMMAND_ID = "cmd_01J00000000000000000000001";
const OUTSIDE_OUTBOX_ID = "obx_01J00000000000000000000001";
const TAMPERED_HASH = `sha256:${"f".repeat(64)}`;

function digestMaterial(
  documentation: WorkspaceDocumentation,
): Omit<WorkspaceDocumentation, "documentationDigest"> {
  const { documentationDigest: _digest, ...material } = documentation;
  return material;
}

function rehashed(
  input: DocumentationInput,
  mutateEvents: (
    events: Array<Record<string, unknown>>,
  ) => void,
): DocumentationInput {
  const cloned = mutable(input);
  const replay = cloned.canonicalReplay as unknown as {
    projectId: CanonicalReplay["projectId"];
    lastSequence: number;
    lastEventHash: string | null;
    events: Array<Record<string, unknown>>;
  };
  mutateEvents(replay.events);
  return {
    ...cloned,
    canonicalReplay: recomputeReplayHashes(
      replay as unknown as CanonicalReplay,
    ),
  };
}

describe("workspace, plan, project, and digest integrity", () => {
  it.each([
    [
      "workspace digest",
      (input: DocumentationInput) => {
        (input.workspace as unknown as { workspaceDigest: string })
          .workspaceDigest = TAMPERED_HASH;
      },
    ],
    [
      "plan digest",
      (input: DocumentationInput) => {
        (input.plan as unknown as { planDigest: string }).planDigest =
          TAMPERED_HASH;
      },
    ],
    [
      "plan-to-workspace binding",
      (input: DocumentationInput) => {
        (input.plan as unknown as { workspaceDigest: string })
          .workspaceDigest = TAMPERED_HASH;
      },
    ],
    [
      "plan project",
      (input: DocumentationInput) => {
        (input.plan as unknown as { projectId: string }).projectId =
          FOREIGN_PROJECT_ID;
      },
    ],
    [
      "replay project",
      (input: DocumentationInput) => {
        (
          input.canonicalReplay as unknown as { projectId: string }
        ).projectId = FOREIGN_PROJECT_ID;
      },
    ],
  ])("fails closed for tampered %s", async (_label, mutateInput) => {
    const input = mutable(await committedInput());
    mutateInput(input);

    expect(() => projectWorkspaceDocumentation(input)).toThrow();
  });

  it.each([
    [
      "workspace binding",
      (value: Record<string, unknown>) => {
        const bindings = value["sourceBindings"] as Record<string, unknown>;
        bindings["workspaceDigest"] = TAMPERED_HASH;
      },
    ],
    [
      "plan binding",
      (value: Record<string, unknown>) => {
        const bindings = value["sourceBindings"] as Record<string, unknown>;
        bindings["planDigest"] = TAMPERED_HASH;
      },
    ],
    [
      "project identity",
      (value: Record<string, unknown>) => {
        const project = value["project"] as Record<string, unknown>;
        project["id"] = FOREIGN_PROJECT_ID;
      },
    ],
    [
      "documentation digest",
      (value: Record<string, unknown>) => {
        value["documentationDigest"] = TAMPERED_HASH;
      },
    ],
  ])("rejects parsed documentation with tampered %s", async (
    _label,
    mutateDocumentation,
  ) => {
    const documentation = mutable(
      projectWorkspaceDocumentation(await committedInput()),
    ) as unknown as Record<string, unknown>;
    mutateDocumentation(documentation);

    expect(() => parseWorkspaceDocumentation(documentation)).toThrow();
  });

  it("does not permit a tampered document to self-certify with a new digest", async () => {
    const documentation = mutable(
      projectWorkspaceDocumentation(await committedInput()),
    );
    (
      documentation.project as unknown as { id: string }
    ).id = FOREIGN_PROJECT_ID;
    (
      documentation as unknown as { documentationDigest: string }
    ).documentationDigest = hashCanonicalValue(
      digestMaterial(documentation),
    );

    expect(() => parseWorkspaceDocumentation(documentation)).toThrow();
  });
});

describe("canonical replay integrity and exact plan binding", () => {
  it.each([
    [
      "reordered events",
      (input: DocumentationInput) =>
        rehashed(input, (events) => {
          events.reverse();
        }),
    ],
    [
      "duplicate event",
      (input: DocumentationInput) =>
        rehashed(input, (events) => {
          events[1] = structuredClone(events[0]!);
        }),
    ],
    [
      "foreign event",
      (input: DocumentationInput) =>
        rehashed(input, (events) => {
          events[0]!["projectId"] = FOREIGN_PROJECT_ID;
        }),
    ],
    [
      "operation mismatch",
      (input: DocumentationInput) =>
        rehashed(input, (events) => {
          events[0]!["operationId"] =
            input.plan.entries[1]!.operationId;
        }),
    ],
    [
      "missing middle event",
      (input: DocumentationInput) =>
        rehashed(input, (events) => {
          events.splice(5, 1);
        }),
    ],
    [
      "event outside the plan",
      (input: DocumentationInput) =>
        rehashed(input, (events) => {
          events.push({
            ...structuredClone(events.at(-1)!),
            id: OUTSIDE_EVENT_ID,
            commandId: OUTSIDE_COMMAND_ID,
            outboxId: OUTSIDE_OUTBOX_ID,
            operationId: OUTSIDE_OPERATION_ID,
          });
        }),
    ],
  ])("rejects %s even when the hash chain is recomputed", async (
    _label,
    tamperReplay,
  ) => {
    const input = await committedInput();

    expect(() =>
      projectWorkspaceDocumentation(tamperReplay(input)),
    ).toThrow();
  });

  it.each([
    [
      "last sequence",
      (replay: Record<string, unknown>) => {
        replay["lastSequence"] = 17;
      },
    ],
    [
      "last event hash",
      (replay: Record<string, unknown>) => {
        replay["lastEventHash"] = TAMPERED_HASH;
      },
    ],
    [
      "previous event hash",
      (replay: Record<string, unknown>) => {
        const events = replay["events"] as Array<Record<string, unknown>>;
        events[1]!["previousEventHash"] = TAMPERED_HASH;
      },
    ],
    [
      "event hash",
      (replay: Record<string, unknown>) => {
        const events = replay["events"] as Array<Record<string, unknown>>;
        events[0]!["eventHash"] = TAMPERED_HASH;
      },
    ],
  ])("rejects canonical replay head/chain tampering: %s", async (
    _label,
    tamperReplay,
  ) => {
    const input = mutable(await committedInput());
    tamperReplay(
      input.canonicalReplay as unknown as Record<string, unknown>,
    );

    expect(() => projectWorkspaceDocumentation(input)).toThrow();
  });
});
