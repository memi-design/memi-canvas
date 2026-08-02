import { useEffect, useState } from "react";
import type { ImportPlanResultV1 } from "@memi/protocol";

import type {
  RepositoryImporter,
  RepositoryImportManifest,
} from "./repository-import.js";
import {
  RepositoryImportManifestSchema,
} from "./repository-import.js";
import {
  RepositoryImportWorkspace,
  type RepositoryImportJobView,
} from "./RepositoryImportWorkspace.js";
import "../figma/figma-import-dialog.css";
import "./repository-import-workspace.css";

const PILOT_AUTH_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
] as const;

type PilotScope = "all" | "auth";

function isSafeSignedOutAuthState(state: string): boolean {
  return [
    "default",
    "guest",
    "signed-out",
    "unauthenticated",
    "sign-in-default",
    "sign-up-default",
    "forgot-password-default",
  ].includes(state.toLowerCase());
}

function signedOutAuthPilotScenarioIds(
  plan: ImportPlanResultV1["plan"],
): readonly ImportPlanResultV1["plan"]["scenarios"][number]["id"][] | undefined {
  const selected = PILOT_AUTH_ROUTES.map((route) =>
    plan.scenarios.filter(
      (scenario) =>
        scenario.route === route && isSafeSignedOutAuthState(scenario.state),
    ),
  );
  return selected.every(([scenario]) => scenario !== undefined) &&
    selected.every((matches) => matches.length === 1)
    ? selected.map(([scenario]) => scenario!.id)
    : undefined;
}

function displayImportError(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) return fallback;
  const details = (error as Error & {
    readonly details?: readonly { readonly key: string; readonly value: string }[];
  }).details;
  const remediation = details?.find(
    (detail) => detail.key === "remediation",
  )?.value;
  return remediation === undefined
    ? error.message
    : `${error.message} ${remediation}`;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function platformLabel(platform: string): string {
  if (platform === "react-native-expo") return "Expo iOS";
  if (platform === "react-web") return "React web";
  if (platform === "swiftui") return "SwiftUI";
  return platform;
}

function preparationNetworkLabel(network: string): string {
  if (network === "none") return "network disabled";
  return "lockfile-pinned downloads";
}

function preparationScriptLabel(scripts: string): string {
  if (scripts === "npm-lifecycle-scripts-disabled") {
    return "scripts disabled";
  }
  if (scripts === "deterministic-hermes-release-selection") {
    return "local Hermes selection";
  }
  return "CocoaPods hooks enabled";
}

function hasBlockingPlanError(
  plan: ImportPlanResultV1["plan"],
): boolean {
  return plan.errors.some(
    ({ code }) => code !== "FIXTURE_REVIEW_REQUIRED",
  );
}

export function RepositoryImportDialog({
  folderPicker,
  importJob,
  importer,
  capturePlanner,
  onCancelImport,
  onClose,
  onImport,
  onResumeImport,
  onRetryFailedImports,
  onRevealImportLogs,
}: {
  readonly folderPicker?: () => Promise<string | null>;
  readonly importJob?: RepositoryImportJobView;
  readonly importer: RepositoryImporter;
  readonly capturePlanner?: (
    rootPath: string,
    options?: Readonly<{
      readonly expoRuntime?: "existing-development-client";
    }>,
  ) => Promise<ImportPlanResultV1["plan"]>;
  readonly onCancelImport?: () => void;
  readonly onClose: () => void;
  readonly onImport: (
    manifest: RepositoryImportManifest,
    approval: Readonly<{
      approvedRecipeHashes: readonly `sha256:${string}`[];
      planToken: ImportPlanResultV1["plan"]["token"];
      pilotScenarioIds?: readonly ImportPlanResultV1["plan"]["scenarios"][number]["id"][];
    }>,
  ) => void | Promise<void>;
  readonly onResumeImport?: () => void;
  readonly onRetryFailedImports?: () => void;
  readonly onRevealImportLogs?: () => void;
}) {
  const [rootPath, setRootPath] = useState("");
  const [manifest, setManifest] =
    useState<RepositoryImportManifest>();
  const [capturePlan, setCapturePlan] =
    useState<ImportPlanResultV1["plan"]>();
  const [useExistingDevelopmentClient, setUseExistingDevelopmentClient] =
    useState(false);
  const [pilotScope, setPilotScope] = useState<PilotScope>("all");
  const [recipesApproved, setRecipesApproved] = useState(false);
  const [showRecipeDetails, setShowRecipeDetails] = useState(false);
  const [expandedCommandId, setExpandedCommandId] = useState<string>();
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const activeJob: RepositoryImportJobView | undefined =
    importJob ??
    (scanning
      ? {
          id: "repository-validation",
          state: "running",
          stage: "validate",
          currentApplication: "Repository",
          activity: "Validating repository",
          elapsedMs: 0,
          failures: [],
        }
      : undefined);
  const canClose =
    activeJob === undefined ||
    activeJob.state === "cancelled" ||
    activeJob.state === "committed" ||
    activeJob.state === "failed";
  const authPilotScenarioIds =
    capturePlan === undefined
      ? undefined
      : signedOutAuthPilotScenarioIds(capturePlan);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canClose) onClose();
    };
    globalThis.addEventListener("keydown", close);
    return () => globalThis.removeEventListener("keydown", close);
  }, [canClose, onClose]);

  async function scan() {
    setScanning(true);
    setError(undefined);
    try {
      const normalizedRoot = rootPath.trim();
      const planned = await capturePlanner?.(
        normalizedRoot,
        useExistingDevelopmentClient
          ? { expoRuntime: "existing-development-client" }
          : undefined,
      );
      const imported =
        planned === undefined
          ? await importer(normalizedRoot)
          : RepositoryImportManifestSchema.parse({
              schemaVersion: 1,
              projectName:
                planned.applications.length === 1
                  ? planned.applications[0]!.label
                  : normalizedRoot.split("/").filter(Boolean).at(-1) ??
                "Imported product",
              rootPath: planned.repository.rootPath,
              revision:
                planned.repository.sourceRevision ?? "unversioned",
              platform: (() => {
                const platforms = new Set(
                  planned.applications.map(({ platform }) => platform),
                );
                if (platforms.size !== 1) return "mixed";
                const platform = [...platforms][0];
                return platform === "expo-ios"
                  ? "react-native-expo"
                  : platform ?? "unknown";
              })(),
              dirty: planned.repository.dirtyFingerprint !== null,
              inventory: planned.inventory,
              files: [],
              screens: planned.inventory.screens,
              components: planned.inventory.components,
              tokens: planned.inventory.tokens,
            });
      setManifest(imported);
      setCapturePlan(planned);
      setPilotScope(
        planned === undefined || signedOutAuthPilotScenarioIds(planned) === undefined
          ? "all"
          : "auth",
      );
      setRecipesApproved(false);
      setShowRecipeDetails(false);
      setExpandedCommandId(undefined);
      setProjectName(imported.projectName);
    } catch (scanError) {
      setError(displayImportError(scanError, "Memi could not scan this repository."));
    } finally {
      setScanning(false);
    }
  }

  async function chooseFolder() {
    setError(undefined);
    try {
      const selected = await folderPicker?.();
      if (selected !== null && selected !== undefined) {
        setRootPath(selected);
        setManifest(undefined);
        setCapturePlan(undefined);
        setPilotScope("all");
        setShowRecipeDetails(false);
        setExpandedCommandId(undefined);
      }
    } catch (pickerError) {
      setError(
        pickerError instanceof Error
          ? pickerError.message
          : "Memi could not open the repository chooser.",
      );
    }
  }

  async function startImport() {
    if (manifest === undefined || projectName.trim() === "") return;
    if (capturePlan === undefined) {
      setError(
        "Memi must produce a runtime capture plan before execution.",
      );
      return;
    }
    setScanning(true);
    setError(undefined);
    try {
      await onImport(
        {
          ...manifest,
          projectName: projectName.trim(),
        },
        {
          planToken: capturePlan.token,
          approvedRecipeHashes: [
            ...capturePlan.recipes.map(({ hash }) => hash),
            ...(capturePlan.dependencyPreparations ?? []).map(
              ({ planFingerprint }) => planFingerprint,
            ),
          ] as readonly `sha256:${string}`[],
          ...(pilotScope === "auth" && authPilotScenarioIds !== undefined
            ? { pilotScenarioIds: authPilotScenarioIds }
            : {}),
        },
      );
    } catch (importFailure) {
      setError(
        displayImportError(
          importFailure,
          "Memi could not start the runtime capture.",
        ),
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div
      className="figma-import-backdrop"
      onPointerDown={canClose ? onClose : undefined}
    >
      <section
        aria-labelledby="repository-import-title"
        aria-modal="true"
        className={
          activeJob === undefined
            ? "figma-import-dialog"
            : "figma-import-dialog repository-import-dialog--workspace"
        }
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="repository-import-title">
              {activeJob === undefined
                ? "Import repository"
                : activeJob.state === "committed"
                  ? "Repository imported"
                  : "Importing repository"}
            </h2>
            <p>
              {activeJob === undefined
                ? "Inspect the source, then capture verified runtime screens."
                : "Memi is preserving runtime truth while it builds the project."}
            </p>
          </div>
          {canClose ? (
            <button
              aria-label="Close repository import"
              className="figma-import-dialog__close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          ) : null}
        </header>
        {activeJob === undefined ? (
          <div className="figma-import-dialog__body">
            <div className="repository-folder-field">
              <label>
                <span>Repository folder</span>
                <input
                  autoFocus
                  onChange={(event) => {
                    setRootPath(event.target.value);
                    setManifest(undefined);
                    setCapturePlan(undefined);
                    setPilotScope("all");
                    setShowRecipeDetails(false);
                    setError(undefined);
                  }}
                  placeholder="/Users/you/Projects/product"
                  value={rootPath}
                />
              </label>
              {folderPicker === undefined ? null : (
                <button
                  onClick={() => void chooseFolder()}
                  type="button"
                >
                  Choose folder
                </button>
              )}
            </div>
            {manifest === undefined ? (
              <label className="repository-import-runtime">
                <input
                  aria-label="Use installed Expo development client"
                  checked={useExistingDevelopmentClient}
                  onChange={(event) =>
                    setUseExistingDevelopmentClient(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>Use installed Expo development client</span>
              </label>
            ) : null}
            {manifest === undefined ? (
              <button
                className="figma-import-dialog__primary"
                disabled={rootPath.trim() === ""}
                onClick={() => void scan()}
                type="button"
              >
                Import repository
              </button>
            ) : (
              <div className="repository-import-summary">
                <section
                  aria-label="Repository summary"
                  className="repository-import-summary__overview"
                >
                  <div>
                    <span>Repository ready</span>
                    <strong>{manifest.projectName}</strong>
                    <small>
                      {platformLabel(manifest.platform)} · {manifest.revision.slice(0, 7)}
                    </small>
                  </div>
                  <p>
                    {manifest.inventory?.screenCount ??
                      manifest.screens.length} screens ·{" "}
                    {manifest.inventory?.componentCount ??
                      manifest.components.length} components
                  </p>
                </section>
                {capturePlan === undefined ? (
                  <p className="figma-import-dialog__message figma-import-dialog__message--error">
                    A durable runtime plan is required before capture.
                  </p>
                ) : (
                  <section
                    aria-label="Capture recipes"
                    className="repository-import-recipes"
                  >
                    <div className="repository-import-recipes__heading">
                      <div>
                        <span>Capture plan</span>
                        <strong>
                          {pluralize(capturePlan.scenarioCount, "runtime scenario")}
                        </strong>
                        <small>Isolated worktree · verified runtime pixels</small>
                      </div>
                      <span className="repository-import-recipes__status">
                        Review
                      </span>
                    </div>
                    <div className="repository-import-recipes__facts">
                      <div>
                        <span>Build</span>
                        <small>{pluralize(capturePlan.recipes.length, "launch recipe")}</small>
                      </div>
                      <div>
                        <span>Prepare</span>
                        <small>
                          {pluralize(
                            (capturePlan.dependencyPreparations ?? []).flatMap(
                              ({ commands }) => commands,
                            ).length,
                            "locked step",
                          )}
                        </small>
                      </div>
                      <div>
                        <span>Safety</span>
                        <small>Scoped writes</small>
                      </div>
                    </div>
                    <div
                      aria-label="Capture scope"
                      className="repository-import-scope"
                      role="radiogroup"
                    >
                      {authPilotScenarioIds === undefined ? null : (
                        <label>
                          <input
                            aria-label={`Pilot auth flow (${pluralize(
                              authPilotScenarioIds.length,
                              "scenario",
                            )})`}
                            checked={pilotScope === "auth"}
                            name="repository-import-scope"
                            onChange={() => setPilotScope("auth")}
                            type="radio"
                            value="auth"
                          />
                          <span>
                            <strong>Pilot auth flow</strong>
                            <small>
                              {pluralize(
                                authPilotScenarioIds.length,
                                "scenario",
                              )}
                            </small>
                          </span>
                        </label>
                      )}
                      <label>
                        <input
                          aria-label={`All discovered scenarios (${pluralize(
                            capturePlan.scenarioCount,
                            "scenario",
                          )})`}
                          checked={pilotScope === "all"}
                          name="repository-import-scope"
                          onChange={() => setPilotScope("all")}
                          type="radio"
                          value="all"
                        />
                        <span>
                          <strong>All discovered scenarios</strong>
                          <small>
                            {pluralize(capturePlan.scenarioCount, "scenario")}
                          </small>
                        </span>
                      </label>
                      <small className="repository-import-scope__selected">
                        {pilotScope === "auth"
                          ? `${authPilotScenarioIds?.length ?? 0} selected`
                          : `${capturePlan.scenarioCount} selected`}
                      </small>
                    </div>
                    <button
                      aria-expanded={showRecipeDetails}
                      className="repository-import-recipes__toggle"
                      onClick={() => setShowRecipeDetails((visible) => !visible)}
                      type="button"
                    >
                      {showRecipeDetails ? "Hide" : "Review"} steps ({
                        capturePlan.recipes.length +
                        (capturePlan.dependencyPreparations ?? []).flatMap(
                          ({ commands }) => commands,
                        ).length
                      })
                    </button>
                    {showRecipeDetails ? (
                      <div className="repository-import-recipes__details">
                        {capturePlan.recipes.map((recipe) => (
                          <article key={recipe.hash}>
                            <button
                              aria-expanded={expandedCommandId === recipe.hash}
                              aria-label={`${expandedCommandId === recipe.hash ? "Collapse" : "Expand"} launch command for ${recipe.applicationLabel}`}
                              className="repository-import-command"
                              onClick={() =>
                                setExpandedCommandId((current) =>
                                  current === recipe.hash ? undefined : recipe.hash,
                                )
                              }
                              type="button"
                            >
                              <span>Launch</span>
                              <strong>{recipe.applicationLabel}</strong>
                              <small title={recipe.cwd}>{recipe.cwd}</small>
                            </button>
                            {expandedCommandId === recipe.hash ? (
                              <code>
                                {recipe.resolvedExecutable} {recipe.args.join(" ")}
                              </code>
                            ) : null}
                          </article>
                        ))}
                        {(capturePlan.dependencyPreparations ?? []).flatMap(
                          (preparation) =>
                            preparation.commands.map((command) => (
                              <article
                                key={`${preparation.applicationId}-${command.id}`}
                              >
                                <button
                                  aria-expanded={expandedCommandId === command.id}
                                  aria-label={`${expandedCommandId === command.id ? "Collapse" : "Expand"} prepare command for ${preparation.applicationLabel}`}
                                  className="repository-import-command"
                                  onClick={() =>
                                    setExpandedCommandId((current) =>
                                      current === command.id
                                        ? undefined
                                        : command.id,
                                    )
                                  }
                                  type="button"
                                >
                                  <span>Prepare</span>
                                  <strong>{preparation.applicationLabel}</strong>
                                  <small title={command.cwd}>{command.cwd}</small>
                                </button>
                                {expandedCommandId === command.id ? (
                                  <>
                                    <code>
                                      {command.executable} {command.args.join(" ")}
                                    </code>
                                    <small>
                                      Network: {preparationNetworkLabel(command.risk.network)} ·{" "}
                                      {preparationScriptLabel(command.risk.scripts)}{" "}
                                      · writes {command.risk.writes.join(", ")}
                                    </small>
                                  </>
                                ) : null}
                              </article>
                            )),
                        )}
                      </div>
                    ) : null}
                    {capturePlan.errors.map((planError) => (
                      <p
                        className="figma-import-dialog__message figma-import-dialog__message--error"
                        key={planError.code}
                      >
                        {planError.code}: {planError.message}{" "}
                        {planError.remediation}
                      </p>
                    ))}
                    <label className="repository-import-recipes__approval">
                      <input
                        aria-label="Approve the reviewed recipes"
                        checked={recipesApproved}
                        disabled={
                          (capturePlan.recipes.length === 0 &&
                            (capturePlan.dependencyPreparations ?? [])
                              .length === 0) ||
                          hasBlockingPlanError(capturePlan)
                        }
                        onChange={(event) =>
                          setRecipesApproved(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>Approve the reviewed recipes</strong>
                        <small>
                          Reviewed steps only.
                        </small>
                      </span>
                    </label>
                  </section>
                )}
                <footer className="repository-import-summary__footer">
                  <label>
                    <span>Project name</span>
                    <input
                      aria-label="Project name"
                      maxLength={256}
                      onChange={(event) =>
                        setProjectName(event.target.value)
                      }
                      value={projectName}
                    />
                  </label>
                  <button
                    className="figma-import-dialog__primary"
                    disabled={
                      projectName.trim() === "" ||
                      capturePlan === undefined ||
                      hasBlockingPlanError(capturePlan) ||
                      !recipesApproved
                    }
                    onClick={() => void startImport()}
                    type="button"
                  >
                    Start verified import
                  </button>
                </footer>
              </div>
            )}
          </div>
        ) : (
          <RepositoryImportWorkspace
            job={activeJob}
            onCancel={onCancelImport}
            onResume={onResumeImport}
            onRetryFailed={onRetryFailedImports}
            onRevealLogs={onRevealImportLogs}
          />
        )}
        {error === undefined ? null : (
          <p
            className="figma-import-dialog__message figma-import-dialog__message--error"
            role="alert"
          >
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
