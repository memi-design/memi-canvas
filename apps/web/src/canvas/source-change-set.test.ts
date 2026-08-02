import { describe, expect, it, vi } from "vitest";

import {
  applyApprovedSourceChangeSet,
  approveSourceChangeSet,
  createSourceChangeSet,
  previewSourceChangeSet,
  rejectSourceChangeSet,
  rollbackSourceChangeSet,
  sha256SourceText,
  type SourceWorkspacePort,
} from "./source-change-set.js";

const ROOT_ID = "connected-project:buzzr";
const PATH = "components/ui/Button.tsx";
const BEFORE = [
  "export function Button() {",
  '  return <Pressable accessibilityLabel="Continue" />;',
  "}",
  "",
].join("\n");
const AFTER = [
  "export function Button() {",
  '  return <Pressable accessibilityLabel="Continue to dashboard" />;',
  "}",
  "",
].join("\n");

interface MemoryWorkspace extends SourceWorkspacePort {
  readonly files: ReadonlyMap<string, string>;
  readonly replacements: readonly {
    readonly expectedRevision: string;
    readonly paths: readonly string[];
  }[];
  setExternalRevision(revision: string): void;
}

function createMemoryWorkspace(
  initialFiles: Readonly<Record<string, string>> = { [PATH]: BEFORE },
  initialRevision = "workspace-revision-7",
): MemoryWorkspace {
  let revision = initialRevision;
  let files = new Map(Object.entries(initialFiles));
  let replacements: {
    readonly expectedRevision: string;
    readonly paths: readonly string[];
  }[] = [];

  return {
    get files() {
      return files;
    },
    get replacements() {
      return replacements;
    },
    async inspect(relativePaths) {
      return {
        files: relativePaths.map((relativePath) => {
          const text = files.get(relativePath);
          if (text === undefined) {
            throw new Error(`Missing source file: ${relativePath}`);
          }
          return { relativePath, text };
        }),
        revision,
        rootId: ROOT_ID,
      };
    },
    async replaceTextFilesAtomically(request) {
      if (request.rootId !== ROOT_ID) {
        throw new Error("Connected project root changed.");
      }
      if (request.expectedRevision !== revision) {
        throw new Error("Workspace revision changed.");
      }
      const next = new Map(files);
      for (const change of request.changes) {
        if (next.get(change.relativePath) !== change.beforeText) {
          throw new Error(`Source changed: ${change.relativePath}`);
        }
        next.set(change.relativePath, change.afterText);
      }
      files = next;
      replacements = [
        ...replacements,
        {
          expectedRevision: request.expectedRevision,
          paths: request.changes.map(({ relativePath }) => relativePath),
        },
      ];
      revision = `workspace-revision-${7 + replacements.length}`;
      return {
        changedPaths: request.changes.map(({ relativePath }) => relativePath),
        revision,
        rootId: ROOT_ID,
      };
    },
    setExternalRevision(nextRevision) {
      revision = nextRevision;
    },
  };
}

async function changeSet(
  overrides: Partial<Parameters<typeof createSourceChangeSet>[0]> = {},
) {
  return createSourceChangeSet({
    actor: {
      harnessId: "codex",
      kind: "agent",
      modelId: "gpt-5.5",
    },
    baseRevision: "workspace-revision-7",
    id: "source-change-button-label",
    patches: [
      {
        expectedBeforeHash: await sha256SourceText(BEFORE),
        relativePath: PATH,
        replacements: [
          {
            after: 'accessibilityLabel="Continue to dashboard"',
            before: 'accessibilityLabel="Continue"',
          },
        ],
        summary: "Clarify the primary button accessibility label.",
      },
    ],
    projectId: "buzzr-ios-mobile-source-v1",
    rootId: ROOT_ID,
    runId: "run-source-button-label",
    ...overrides,
  });
}

function traceOptions() {
  let sequence = 0;
  return {
    idFactory: () => `source-event-${++sequence}`,
    now: () => "2026-07-29T12:00:00.000Z",
  };
}

describe("source ChangeSet safety contract", () => {
  it.each([
    "",
    "../Secrets.ts",
    "/etc/passwd",
    "components\\ui\\Button.tsx",
    "./components/ui/Button.tsx",
    "components//Button.tsx",
    ".git/config",
    ".env",
    "x".repeat(1_025),
    "components/\u0000Button.tsx",
  ])("rejects a source path outside the connected project: %s", async (relativePath) => {
    await expect(
      changeSet({
        patches: [
          {
            expectedBeforeHash: await sha256SourceText(BEFORE),
            relativePath,
            replacements: [{ after: "new", before: "old" }],
            summary: "Unsafe path",
          },
        ],
      }),
    ).rejects.toThrow(/inside the connected project/i);
  });

  it("rejects duplicate paths, ambiguous empty anchors, binary text, and non-SHA fingerprints", async () => {
    const valid = (await changeSet()).patches[0]!;

    await expect(
      changeSet({ patches: [valid, valid] }),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      changeSet({
        patches: [
          {
            ...valid,
            replacements: [{ after: "new", before: "" }],
          },
        ],
      }),
    ).rejects.toThrow(/anchor/i);
    await expect(
      changeSet({
        patches: [
          {
            ...valid,
            replacements: [{ after: "new\u0000", before: "old" }],
          },
        ],
      }),
    ).rejects.toThrow(/binary/i);
    await expect(
      changeSet({
        patches: [{ ...valid, expectedBeforeHash: "not-a-hash" }],
      }),
    ).rejects.toThrow(/sha-256/i);
  });

  it("bounds patch count, replacement count, and individual replacement size", async () => {
    const valid = (await changeSet()).patches[0]!;
    await expect(changeSet({ patches: [] })).rejects.toThrow(
      /between 1 and 64 patches/i,
    );
    await expect(
      changeSet({
        patches: [{ ...valid, replacements: [] }],
      }),
    ).rejects.toThrow(/between 1 and 256 replacements/i);
    await expect(
      changeSet({
        patches: [
          {
            ...valid,
            replacements: [
              {
                after: "x".repeat(256_001),
                before: "anchor",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/256000-byte limit/i);
  });

  it("deeply freezes a validated ChangeSet", async () => {
    const sourceChangeSet = await changeSet();

    expect(Object.isFrozen(sourceChangeSet)).toBe(true);
    expect(Object.isFrozen(sourceChangeSet.actor)).toBe(true);
    expect(Object.isFrozen(sourceChangeSet.patches)).toBe(true);
    expect(Object.isFrozen(sourceChangeSet.patches[0]?.replacements)).toBe(true);
    expect(sourceChangeSet.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("uses a canonical digest independent of input property insertion order", async () => {
    const expectedBeforeHash = await sha256SourceText(BEFORE);
    const canonical = await changeSet();
    const reordered = await createSourceChangeSet({
      runId: "run-source-button-label",
      rootId: ROOT_ID,
      projectId: "buzzr-ios-mobile-source-v1",
      patches: [
        {
          summary: "Clarify the primary button accessibility label.",
          replacements: [
            {
              before: 'accessibilityLabel="Continue"',
              after: 'accessibilityLabel="Continue to dashboard"',
            },
          ],
          relativePath: PATH,
          expectedBeforeHash,
        },
      ],
      id: "source-change-button-label",
      baseRevision: "workspace-revision-7",
      actor: {
        modelId: "gpt-5.5",
        kind: "agent",
        harnessId: "codex",
      },
    });

    expect(reordered.digest).toBe(canonical.digest);
  });

  it("rejects aggregate replacement payloads above the bounded review limit", async () => {
    const valid = (await changeSet()).patches[0]!;
    await expect(
      changeSet({
        patches: [
          {
            ...valid,
            replacements: Array.from({ length: 5 }, (_, index) => ({
              after: `${index}${"x".repeat(220_000)}`,
              before: `anchor-${index}`,
            })),
          },
        ],
      }),
    ).rejects.toThrow(/aggregate.*byte limit/i);
  });
});

describe("source ChangeSet review lifecycle", () => {
  it("previews an exact immutable diff without writing to the workspace", async () => {
    const workspace = createMemoryWorkspace();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      traceOptions(),
    );

    expect(review).toMatchObject({
      status: "ready",
      currentRevision: "workspace-revision-7",
    });
    expect(review.files).toEqual([
      {
        afterText: AFTER,
        beforeText: BEFORE,
        relativePath: PATH,
      },
    ]);
    expect(review.diff).toContain(`--- a/${PATH}`);
    expect(review.diff).toContain(`+++ b/${PATH}`);
    expect(review.diff).toContain('-accessibilityLabel="Continue"');
    expect(review.diff).toContain('+accessibilityLabel="Continue to dashboard"');
    expect(review.trace.map(({ family }) => family)).toEqual([
      "source.previewed",
    ]);
    expect(workspace.replacements).toHaveLength(0);
    expect(Object.isFrozen(review)).toBe(true);
  });

  it("preserves revision and source-content conflicts as reviewable results", async () => {
    const revisionConflict = await previewSourceChangeSet(
      await changeSet(),
      createMemoryWorkspace({ [PATH]: BEFORE }, "workspace-revision-8"),
      traceOptions(),
    );
    expect(revisionConflict.status).toBe("conflict");
    expect(revisionConflict.message).toMatch(/revision/i);

    const sourceConflict = await previewSourceChangeSet(
      await changeSet(),
      createMemoryWorkspace({ [PATH]: `${BEFORE}// human edit\n` }),
      traceOptions(),
    );
    expect(sourceConflict.status).toBe("conflict");
    expect(sourceConflict.message).toContain(PATH);
  });

  it("treats inspection failure, root changes, omitted files, and ambiguous anchors as conflicts", async () => {
    const sourceChangeSet = await changeSet();
    const inspectFailure = await previewSourceChangeSet(
      sourceChangeSet,
      {
        inspect: async () => {
          throw new Error("Source reader unavailable.");
        },
        replaceTextFilesAtomically: async () => {
          throw new Error("unreachable");
        },
      },
      traceOptions(),
    );
    expect(inspectFailure).toMatchObject({ status: "conflict" });
    expect(inspectFailure.message).toMatch(/reader unavailable/i);

    const rootConflict = await previewSourceChangeSet(
      sourceChangeSet,
      {
        inspect: async () => ({
          files: [{ relativePath: PATH, text: BEFORE }],
          revision: "workspace-revision-7",
          rootId: "connected-project:other",
        }),
        replaceTextFilesAtomically: async () => {
          throw new Error("unreachable");
        },
      },
      traceOptions(),
    );
    expect(rootConflict.message).toMatch(/root changed/i);

    const omitted = await previewSourceChangeSet(
      sourceChangeSet,
      {
        inspect: async () => ({
          files: [],
          revision: "workspace-revision-7",
          rootId: ROOT_ID,
        }),
        replaceTextFilesAtomically: async () => {
          throw new Error("unreachable");
        },
      },
      traceOptions(),
    );
    expect(omitted.message).toContain(PATH);

    const ambiguousText = BEFORE.replace(
      "/>;",
      ' accessibilityLabel="Continue" />;',
    );
    const ambiguousChangeSet = await changeSet({
      patches: [
        {
          ...sourceChangeSet.patches[0]!,
          expectedBeforeHash: await sha256SourceText(ambiguousText),
        },
      ],
    });
    const ambiguous = await previewSourceChangeSet(
      ambiguousChangeSet,
      createMemoryWorkspace({ [PATH]: ambiguousText }),
      traceOptions(),
    );
    expect(ambiguous.message).toMatch(/matched 2 times/i);
  });

  it("detects overlapping exact anchors as ambiguous", async () => {
    const text = "const value = 'ababa';\n";
    const overlapping = await changeSet({
      patches: [
        {
          expectedBeforeHash: await sha256SourceText(text),
          relativePath: PATH,
          replacements: [{ after: "updated", before: "aba" }],
          summary: "Replace one exact anchor.",
        },
      ],
    });

    const review = await previewSourceChangeSet(
      overlapping,
      createMemoryWorkspace({ [PATH]: text }),
      traceOptions(),
    );

    expect(review.status).toBe("conflict");
    expect(review.message).toMatch(/matched 2 times/i);
  });

  it("requires an exact approval bound to the preview digest and revision", async () => {
    const workspace = createMemoryWorkspace();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      traceOptions(),
    );
    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      traceOptions(),
    );

    expect(approval).toMatchObject({
      approvedBy: { id: "sarvesh", kind: "human" },
      baseRevision: "workspace-revision-7",
      changeSetDigest: review.changeSet.digest,
      rootId: ROOT_ID,
      usesRemaining: 1,
    });
    expect(workspace.replacements).toHaveLength(0);
  });

  it("applies atomically after approval and verifies the exact resulting text", async () => {
    const workspace = createMemoryWorkspace();
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      options,
    );
    const result = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );

    expect(result).toMatchObject({
      status: "applied",
      verification: {
        checkedRevision: "workspace-revision-8",
        status: "passed",
      },
    });
    expect(result.receipt?.changedPaths).toEqual([PATH]);
    expect(workspace.files.get(PATH)).toBe(AFTER);
    expect(workspace.replacements).toEqual([
      {
        expectedRevision: "workspace-revision-7",
        paths: [PATH],
      },
    ]);
    expect(result.trace.map(({ family }) => family)).toEqual([
      "source.previewed",
      "source.approved",
      "source.applied",
      "source.verified",
    ]);
  });

  it("fails closed if the workspace changes after preview and does not write", async () => {
    const workspace = createMemoryWorkspace();
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      options,
    );
    workspace.setExternalRevision("workspace-revision-human-edit");

    const result = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/revision/i);
    expect(result.trace.at(-1)?.family).toBe("source.failed");
    expect(workspace.files.get(PATH)).toBe(BEFORE);
    expect(workspace.replacements).toHaveLength(0);
  });

  it("consumes approval once and rejects a replay without another write", async () => {
    const workspace = createMemoryWorkspace();
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      options,
    );
    const first = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );
    expect(first.status).toBe("applied");

    const replay = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );
    expect(replay.status).toBe("failed");
    expect(replay.message).toMatch(/approval/i);
    expect(workspace.replacements).toHaveLength(1);
  });

  it("retains the atomic write receipt when post-write inspection fails so rollback remains possible", async () => {
    const memory = createMemoryWorkspace();
    let inspections = 0;
    const workspace: SourceWorkspacePort = {
      inspect: async (paths) => {
        inspections += 1;
        if (inspections === 3) {
          throw new Error("Post-write source inspection unavailable.");
        }
        return memory.inspect(paths);
      },
      replaceTextFilesAtomically: (request) =>
        memory.replaceTextFilesAtomically(request),
    };
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      options,
    );

    const result = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );

    expect(result.status).toBe("failed");
    expect(result.receipt).toMatchObject({
      changedPaths: [PATH],
      revision: "workspace-revision-8",
    });
    expect(result.message).toMatch(/rollback remains available/i);
    expect(memory.files.get(PATH)).toBe(AFTER);
  });

  it("rejects without applying and records the human decision", async () => {
    const workspace = createMemoryWorkspace();
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    const rejected = rejectSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      "Keep the current product copy.",
      options,
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.message).toMatch(/keep the current product copy/i);
    expect(rejected.trace.at(-1)?.family).toBe("source.rejected");
    expect(workspace.files.get(PATH)).toBe(BEFORE);
    expect(workspace.replacements).toHaveLength(0);
  });

  it("refuses unauditable blank human identities for rejection and rollback", async () => {
    const workspace = createMemoryWorkspace();
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    expect(() =>
      rejectSourceChangeSet(
        review,
        { id: "   ", kind: "human" },
        "No",
        options,
      ),
    ).toThrow(/actor id/i);

    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      options,
    );
    const applied = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );
    await expect(
      rollbackSourceChangeSet(
        applied,
        workspace,
        { id: "", kind: "human" },
        options,
      ),
    ).rejects.toThrow(/actor id/i);
    expect(workspace.files.get(PATH)).toBe(AFTER);
  });

  it("rolls back only the exact applied revision and verifies the restored source", async () => {
    const workspace = createMemoryWorkspace();
    const options = traceOptions();
    const review = await previewSourceChangeSet(
      await changeSet(),
      workspace,
      options,
    );
    const approval = approveSourceChangeSet(
      review,
      { id: "sarvesh", kind: "human" },
      options,
    );
    const applied = await applyApprovedSourceChangeSet(
      review,
      approval,
      workspace,
      options,
    );
    const rolledBack = await rollbackSourceChangeSet(
      applied,
      workspace,
      { id: "sarvesh", kind: "human" },
      options,
    );

    expect(rolledBack).toMatchObject({
      status: "rolled-back",
      verification: {
        checkedRevision: "workspace-revision-9",
        status: "passed",
      },
    });
    expect(workspace.files.get(PATH)).toBe(BEFORE);
    expect(rolledBack.trace.at(-2)?.family).toBe("source.rolled-back");
    expect(rolledBack.trace.at(-1)?.family).toBe("source.verified");

    workspace.setExternalRevision("workspace-revision-human-edit");
    await expect(
      rollbackSourceChangeSet(
        applied,
        workspace,
        { id: "sarvesh", kind: "human" },
        options,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/revision/i),
    });
  });

  it("never exposes process, shell, Git, network, or deploy authority", async () => {
    const change = await changeSet();
    const contract = JSON.stringify(change);

    expect(contract).not.toMatch(
      /command|process|shell|git|network|deploy|publish|url/i,
    );
    expect(
      Object.keys(createMemoryWorkspace()).sort(),
    ).toEqual([
      "files",
      "inspect",
      "replaceTextFilesAtomically",
      "replacements",
      "setExternalRevision",
    ]);
    expect(vi.isMockFunction(createMemoryWorkspace().inspect)).toBe(false);
  });
});
