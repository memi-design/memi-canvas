import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportPlanResultSchemaV1 } from "@memi/protocol";

import { RepositoryImportDialog } from "./RepositoryImportDialog.js";

describe("RepositoryImportDialog", () => {
  const capturePlan = ImportPlanResultSchemaV1.parse({
    plan: {
      token: "ipl_01J00000000000000000000000",
      repository: {
        dirtyFingerprint: null,
        rootPath: "/Projects/northstar",
        sourceRevision: "a".repeat(40),
      },
      applications: [
        {
          id: "northstar-web",
          label: "Northstar",
          platform: "react-web",
          relativeRoot: ".",
        },
      ],
      recipes: [
        {
          applicationId: "northstar-web",
          applicationLabel: "Northstar web",
          adapterId: "react-web",
          adapterVersion: "1",
          executable: "npm",
          resolvedExecutable: "/usr/local/bin/npm",
          args: ["run", "dev"],
          cwd: "/Projects/northstar",
          purpose: "launch",
          hash: `sha256:${"b".repeat(64)}`,
          expiresAt: "2026-07-30T12:00:00.000Z",
        },
      ],
      dependencyPreparations: [
        {
          applicationId: "northstar-web",
          applicationLabel: "Northstar web",
          adapterVersion: "1",
          planFingerprint: `sha256:${"c".repeat(64)}`,
          repositoryRevision: "a".repeat(40),
          policy: {
            contract: "memi.native-dependency-preparation-policy.v1",
            network: "locked-dependency-downloads",
            npmLifecycleScripts: "disabled",
            cocoapodsHooks: "enabled",
            requireLockfiles: true,
            sandboxProfileFingerprint: `sha256:${"d".repeat(64)}`,
          },
          lockfiles: [
            {
              relativePath: "package-lock.json",
              sha256: `sha256:${"e".repeat(64)}`,
              byteLength: 420,
            },
          ],
          commands: [
            {
              id: "npm-ci",
              executable: "/usr/local/bin/node",
              args: [
                "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
                "ci",
                "--ignore-scripts",
              ],
              cwd: "/Projects/northstar",
              lockfileRelativePaths: ["package-lock.json"],
              risk: {
                network: "downloads-lockfile-pinned-packages",
                scripts: "npm-lifecycle-scripts-disabled",
                writes: ["node_modules"],
              },
            },
          ],
        },
      ],
      inventory: {
        fileCount: 14,
        screenCount: 1,
        componentCount: 2,
        tokenCount: 1,
        screens: [
          {
            id: "northstar-home",
            name: "Home",
            route: "/",
            sourcePath: "src/pages/Home.tsx",
          },
        ],
        components: [
          {
            id: "northstar-button",
            name: "Button",
            sourcePath: "src/components/Button.tsx",
          },
          {
            id: "northstar-card",
            name: "Card",
            sourcePath: "src/components/Card.tsx",
          },
        ],
        tokens: [
          {
            id: "northstar-tokens",
            name: "Tokens",
            sourcePath: "src/styles/tokens.css",
          },
        ],
        truncated: {
          screens: false,
          components: false,
          tokens: false,
        },
      },
      scenarios: [],
      scenarioCount: 1,
      errors: [],
    },
  }).plan;
  const baseProps = {
    importer: vi.fn(),
    onClose: vi.fn(),
    onImport: vi.fn(),
  } as const;

  it("requests the explicitly selected installed Expo development client during planning", async () => {
    const capturePlanner = vi.fn(async () => capturePlan);
    render(
      <RepositoryImportDialog
        capturePlanner={capturePlanner}
        importer={vi.fn()}
        onClose={() => undefined}
        onImport={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByLabelText("Use installed Expo development client"),
    );
    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/buzzr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));

    await waitFor(() => {
      expect(capturePlanner).toHaveBeenCalledWith("/Projects/buzzr", {
        expoRuntime: "existing-development-client",
      });
    });
  });

  it("defaults only the exact signed-out auth trio to the bounded pilot import", async () => {
    const authPilotPlan = ImportPlanResultSchemaV1.parse({
      plan: {
        ...capturePlan,
        scenarioCount: 4,
        scenarios: [
          {
            id: "csc_01J00000000000000000000001",
            applicationId: "northstar-web",
            route: "/sign-in",
            state: "signed-out",
            viewport: { width: 390, height: 844, name: "iphone-15", scale: 3 },
            sourceAnchor: null,
          },
          {
            id: "csc_01J00000000000000000000002",
            applicationId: "northstar-web",
            route: "/sign-up",
            state: "signed-out",
            viewport: { width: 390, height: 844, name: "iphone-15", scale: 3 },
            sourceAnchor: null,
          },
          {
            id: "csc_01J00000000000000000000003",
            applicationId: "northstar-web",
            route: "/forgot-password",
            state: "signed-out",
            viewport: { width: 390, height: 844, name: "iphone-15", scale: 3 },
            sourceAnchor: null,
          },
          {
            id: "csc_01J00000000000000000000004",
            applicationId: "northstar-web",
            route: "/dashboard",
            state: "signed-in",
            viewport: { width: 390, height: 844, name: "iphone-15", scale: 3 },
            sourceAnchor: null,
          },
        ],
      },
    }).plan;
    const onImport = vi.fn();
    render(
      <RepositoryImportDialog
        capturePlanner={async () => authPilotPlan}
        importer={vi.fn()}
        onClose={() => undefined}
        onImport={onImport}
      />,
    );

    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));

    const pilot = await screen.findByRole("radio", {
      name: "Pilot auth flow (3 scenarios)",
    });
    const all = screen.getByRole("radio", {
      name: "All discovered scenarios (4 scenarios)",
    });
    expect((pilot as HTMLInputElement).checked).toBe(true);
    expect((all as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Approve the reviewed recipes"));
    fireEvent.click(screen.getByRole("button", { name: "Start verified import" }));
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          pilotScenarioIds: [
            "csc_01J00000000000000000000001",
            "csc_01J00000000000000000000002",
            "csc_01J00000000000000000000003",
          ],
        }),
      );
    });

    fireEvent.click(screen.getByText("All discovered scenarios"));
    await waitFor(() => {
      expect(screen.getByText("4 selected")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start verified import" }));
    await waitFor(() => {
      expect(onImport).toHaveBeenLastCalledWith(
        expect.any(Object),
        expect.not.objectContaining({ pilotScenarioIds: expect.anything() }),
      );
    });
  });

  it("keeps the capture plan legible until the user explicitly reviews exact commands", async () => {
    const importer = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      projectName: "Northstar",
      rootPath: "/Projects/northstar",
      revision: "a1b2c3d4",
      platform: "react-web",
      dirty: false,
      files: [],
      screens: [],
      components: [],
      tokens: [],
    });
    let finishImport: () => void = () => undefined;
    const onImport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishImport = resolve;
        }),
    );
    render(
      <RepositoryImportDialog
        capturePlanner={async () => capturePlan}
        importer={importer}
        onClose={() => undefined}
        onImport={onImport}
      />,
    );

    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));

    expect(await screen.findByText("Northstar")).toBeTruthy();
    expect(screen.queryByLabelText("Analysis harness")).toBeNull();
    expect(importer).not.toHaveBeenCalled();
    expect(screen.getByText("1 screens · 2 components")).toBeTruthy();
    expect(screen.getByText("1 runtime scenario")).toBeTruthy();
    expect(
      screen.getByText("Isolated worktree · verified runtime pixels"),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts",
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Review steps (2)" }),
    );
    expect(
      screen.queryByText(
        "/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts",
      ),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand prepare command for Northstar web",
      }),
    );
    expect(
      screen.getByText(
        "/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Network: lockfile-pinned downloads · scripts disabled · writes node_modules",
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Northstar product" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Approve the reviewed recipes",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start verified import" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Importing repository" }),
    ).toBeTruthy();
    finishImport();
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "Northstar product" }),
      {
        approvedRecipeHashes: [
          `sha256:${"b".repeat(64)}`,
          `sha256:${"c".repeat(64)}`,
        ],
        planToken: capturePlan.token,
      },
    );
  });

  it("allows a reviewed import to continue when only individual fixture diagnostics remain", async () => {
    const planWithFixtureDiagnostic = ImportPlanResultSchemaV1.parse({
      plan: {
        ...capturePlan,
        errors: [{
          code: "FIXTURE_REVIEW_REQUIRED",
          message:
            "The capture scenario /games/:gameId requires a reviewed deterministic fixture before runtime capture.",
          remediation:
            "Review a fixture proposal with non-secret parameters for /games/:gameId, then retry this scenario.",
          retryable: true,
        }],
      },
    }).plan;
    let finishImport: () => void = () => undefined;
    const onImport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishImport = resolve;
        }),
    );
    render(
      <RepositoryImportDialog
        capturePlanner={async () => planWithFixtureDiagnostic}
        importer={vi.fn()}
        onClose={() => undefined}
        onImport={onImport}
      />,
    );

    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));
    await screen.findByText("FIXTURE_REVIEW_REQUIRED:", { exact: false });

    const approval = screen.getByLabelText(
      "Approve the reviewed recipes",
    ) as HTMLInputElement;
    expect(approval.disabled).toBe(false);
    fireEvent.click(approval);
    expect(
      (screen.getByRole("button", {
        name: "Start verified import",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Start verified import" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Importing repository" }),
    ).toBeTruthy();
    finishImport();
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("uses the native folder chooser before scanning", async () => {
    const folderPicker = vi
      .fn()
      .mockResolvedValue("/Projects/northstar");
    const importer = vi.fn().mockRejectedValue(new Error("Stop after proof"));
    render(
      <RepositoryImportDialog
        folderPicker={folderPicker}
        importer={importer}
        onClose={() => undefined}
        onImport={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(
      (await screen.findByLabelText("Repository folder") as HTMLInputElement)
        .value,
    ).toBe("/Projects/northstar");
  });

  it("shows the runtime's safe remediation when planning cannot continue", async () => {
    const plannerFailure = Object.assign(
      new Error("A source path escaped the selected repository boundary."),
      {
        details: [
          {
            key: "remediation",
            value:
              "Select the repository root again and remove paths that resolve outside it.",
          },
        ],
      },
    );
    render(
      <RepositoryImportDialog
        {...baseProps}
        capturePlanner={async () => {
          throw plannerFailure;
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Select the repository root again and remove paths that resolve outside it.",
    );
  });

  it("presents a determinate long-running capture job with truthful counts", () => {
    const onCancelImport = vi.fn();
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-1",
          state: "running",
          stage: "capture",
          progress: { captured: 6, failed: 1, remaining: 3, total: 10 },
          currentApplication: "Northstar iOS",
          currentScenario: "/dashboard · signed-in",
          activity: "Waiting for two stable runtime frames",
          elapsedMs: 154_000,
          failures: [],
        }}
        onCancelImport={onCancelImport}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Importing repository" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Import stages" }).children,
    ).toHaveLength(10);
    for (const stage of [
      "Validate",
      "Inventory",
      "Plan",
      "Prepare fixtures",
      "Build",
      "Launch",
      "Capture",
      "Extract layers",
      "Verify",
      "Save",
    ]) {
      expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByRole("progressbar").getAttribute("aria-valuenow"),
    ).toBe("70");
    expect(screen.getByLabelText("6 captured")).toBeTruthy();
    expect(screen.getByLabelText("1 failed")).toBeTruthy();
    expect(screen.getByLabelText("3 remaining")).toBeTruthy();
    expect(screen.getByText("Northstar iOS")).toBeTruthy();
    expect(screen.getByText("/dashboard · signed-in")).toBeTruthy();
    expect(
      screen.getByText("Waiting for two stable runtime frames"),
    ).toBeTruthy();
    expect(screen.getByText("2m 34s")).toBeTruthy();
    expect(
      screen
        .getByRole("listitem", { name: "Capture, current stage" })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(
      (
        screen.getByRole("button", {
          name: "Cancel import",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("lets the user close a terminal failed import without losing its retry state", () => {
    const onClose = vi.fn();
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-failed",
          state: "failed",
          stage: "capture",
          progress: { captured: 1, failed: 1, remaining: 0, total: 2 },
          elapsedMs: 12_000,
          failures: [],
        }}
        onClose={onClose}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close repository import" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("replaces the form with a clean loading workspace while validating", async () => {
    const importer = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    render(
      <RepositoryImportDialog {...baseProps} importer={importer} />,
    );

    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));

    expect(
      await screen.findByRole("heading", { name: "Importing repository" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("progressbar").getAttribute("aria-valuetext"),
    ).toBe("Working");
    expect(screen.getByText("Validating repository")).toBeTruthy();
  });

  it("uses indeterminate progress before scenario totals are known", () => {
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-2",
          state: "running",
          stage: "inventory",
          currentApplication: "Northstar web",
          activity: "Discovering routes and runtime states",
          elapsedMs: 9_000,
          failures: [],
        }}
      />,
    );

    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBeNull();
    expect(progress.getAttribute("aria-valuetext")).toBe("Working");
    expect(screen.getByText("Discovering scenarios…")).toBeTruthy();
  });

  it("renders actionable capture failures without fake screen copy", () => {
    const onRetryFailed = vi.fn();
    const onRevealLogs = vi.fn();
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-3",
          state: "paused",
          stage: "verify",
          progress: {
            captured: 10,
            failed: 1,
            remaining: 1,
            total: 12,
          },
          currentApplication: "Northstar iOS",
          elapsedMs: 62_000,
          failures: [
            {
              id: "failure-1",
              route: "/account",
              state: "signed-in",
              sourcePath: "app/account.tsx",
              code: "READINESS_TIMEOUT",
              message: [
                "The account heading did not become ready.",
                "node:fs:2791 const stats = binding.lstat(base, true, undefined, true);",
                "at Object.realpathSync (node:fs:2791:29)",
              ].join("\n"),
              remediation:
                "Confirm the fixture signs in before opening this route.",
              retryable: true,
            },
          ],
        }}
        onRevealImportLogs={onRevealLogs}
        onRetryFailedImports={onRetryFailed}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "/account · signed-in" }),
    ).toBeTruthy();
    expect(screen.getByText("app/account.tsx")).toBeTruthy();
    expect(screen.getByText("READINESS_TIMEOUT")).toBeTruthy();
    expect(
      screen.getByText(
        "Confirm the fixture signs in before opening this route.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("The account heading did not become ready."),
    ).toBeTruthy();
    expect(screen.queryByText(/node:fs:2791/u)).toBeNull();
    expect(screen.queryByText(/capture unavailable/i)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry failed" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal logs" }));
    expect(onRetryFailed).toHaveBeenCalledOnce();
    expect(onRevealLogs).toHaveBeenCalledOnce();
  });

  it("keeps a large failure set readable while retaining the first actionable diagnostics", () => {
    const failures = ["/account", "/profile", "/feed", "/settings"].map(
      (route, index) => ({
        id: `failure-${index}`,
        route,
        code: "READINESS_TIMEOUT",
        message: `The ${route} screen did not become ready before capture.`,
        remediation: "Review the fixture, then retry this scenario.",
        retryable: true,
      }),
    );
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-many-failures",
          state: "paused",
          stage: "capture",
          progress: { captured: 0, failed: 4, remaining: 0, total: 4 },
          elapsedMs: 61_000,
          failures,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "/account" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "/feed" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "/settings" })).toBeNull();
    expect(screen.getByText("1 more failure in logs")).toBeTruthy();
  });

  it("keeps long reviewed command paths visually compact until expanded", async () => {
    render(
      <RepositoryImportDialog
        capturePlanner={async () => capturePlan}
        importer={vi.fn()}
        onClose={() => undefined}
        onImport={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));

    await screen.findByText("Northstar");
    fireEvent.click(screen.getByRole("button", { name: "Review steps (2)" }));

    expect(screen.getAllByText("Northstar web")).toHaveLength(2);
    expect(
      screen.queryByText(
        "/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts",
      ),
    ).toBeNull();
  });

  it("offers resume for a paused import and delegates the action", () => {
    const onResume = vi.fn();
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-4",
          state: "paused",
          stage: "build",
          progress: { captured: 2, failed: 0, remaining: 6, total: 8 },
          currentApplication: "Northstar iOS",
          elapsedMs: 45_000,
          failures: [],
        }}
        onResumeImport={onResume}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume import" }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("keeps an active capture visible until the user explicitly cancels", () => {
    const onClose = vi.fn();
    render(
      <RepositoryImportDialog
        {...baseProps}
        importJob={{
          id: "import-5",
          state: "running",
          stage: "capture",
          progress: { captured: 1, failed: 0, remaining: 1, total: 2 },
          elapsedMs: 5_000,
          failures: [],
        }}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.querySelector(".figma-import-backdrop")!);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Close repository import" }),
    ).toBeNull();
  });
});
