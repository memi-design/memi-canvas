import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./theme/studio-tokens.css";
import "./styles.css";
import "./workspace-documentation.css";
import { MemiApp } from "./MemiApp";
import { WorkspaceDocumentationConsumer } from "./WorkspaceDocumentationConsumer";
import type { CanvasRuntimePortV1 } from "./canvas/canvas-runtime-port.js";
import type { RepositoryCaptureRuntime } from "./imports/repository/repository-capture-runtime.js";
import type { RepositoryReconstructionArtifactLoader } from "./imports/repository/repository-reconstruction-rehydration.js";
import type { RuntimeClientV1 } from "./runtime/runtime-client.js";
import { hasCompletedTruthfulImportRuntimeReset } from "./runtime/truthful-import-reset.js";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Memi Canvas could not find the application root.");
}

const search = new URLSearchParams(globalThis.location.search);
const showDocumentation = search.get("view") === "documentation";
let runtimePort: CanvasRuntimePortV1 | undefined;
let repositoryCaptureRuntime: RepositoryCaptureRuntime | undefined;
let reconstructionArtifactLoader:
  | RepositoryReconstructionArtifactLoader
  | undefined;
let runtimeClient: RuntimeClientV1 | undefined;
let truthfulImportResetReady = !("__TAURI_INTERNALS__" in globalThis);
const runtimeFixtureEnabled =
  import.meta.env.DEV || import.meta.env.VITE_MEMI_E2E_DEMO_RUNTIME === "1";
if (runtimeFixtureEnabled && search.get("runtime") === "demo") {
  const { createDemoCanvasRuntimePort, createLocalCanvasRuntimeStorage } =
    await import("./canvas/canvas-runtime-port.js");
  runtimePort = createDemoCanvasRuntimePort({
    storage: createLocalCanvasRuntimeStorage(globalThis.localStorage),
  });
}
if ("__TAURI_INTERNALS__" in globalThis) {
  try {
    const [
      { createRuntimeClientCaptureRuntime },
      { createTauriRuntimeConnection },
      { ensureTruthfulImportRuntimeReset },
    ] = await Promise.all([
      import("./imports/repository/runtime-client-capture-runtime.js"),
      import("./runtime/tauri-runtime-client.js"),
      import("./runtime/truthful-import-reset.js"),
    ]);
    const native = await createTauriRuntimeConnection();
    truthfulImportResetReady = await ensureTruthfulImportRuntimeReset({
      imports: native.client.imports,
      storage: globalThis.localStorage,
    });
    if (!truthfulImportResetReady) {
      throw new Error("Memi-owned import cleanup is incomplete.");
    }
    runtimeClient = native.client;
    reconstructionArtifactLoader = async (artifactId) => {
      const artifact = await native.loadArtifact(artifactId);
      if (artifact.mimeType !== "application/json") {
        throw new Error(
          "Semantic reconstruction requires a JSON content artifact.",
        );
      }
      return JSON.parse(new TextDecoder().decode(artifact.bytes));
    };
    repositoryCaptureRuntime = createRuntimeClientCaptureRuntime({
      artifactUrl: (artifactId) => `memi-artifact://localhost/${artifactId}`,
      client: native.client,
      loadReconstructionArtifact: reconstructionArtifactLoader,
      revealLogs: native.revealLogs,
    });
  } catch {
    runtimeClient = undefined;
    repositoryCaptureRuntime = undefined;
    reconstructionArtifactLoader = undefined;
    truthfulImportResetReady = hasCompletedTruthfulImportRuntimeReset(
      globalThis.localStorage,
    );
    // Import remains fail-closed when the authenticated sidecar is unavailable.
  }
}

createRoot(root).render(
  <StrictMode>
    {showDocumentation ? (
      <WorkspaceDocumentationConsumer />
    ) : (
      <MemiApp
        truthfulImportResetReady={truthfulImportResetReady}
        {...(runtimeClient === undefined ? {} : { runtimeClient })}
        {...(runtimePort === undefined ? {} : { runtimePort })}
        {...(repositoryCaptureRuntime === undefined
          ? {}
          : { repositoryCaptureRuntime })}
        {...(reconstructionArtifactLoader === undefined
          ? {}
          : { reconstructionArtifactLoader })}
      />
    )}
  </StrictMode>,
);
