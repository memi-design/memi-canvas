import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseWorkspaceDocumentation } from "@memi/workspace-documentation";

import artifact from "./workspace-documentation.fixture.json";
import {
  WorkspaceDocumentationConsumer,
  fetchWorkspaceDocumentation,
} from "./WorkspaceDocumentationConsumer";

const validDocumentation = parseWorkspaceDocumentation(artifact);

function successfulLoader() {
  return Promise.resolve(structuredClone(validDocumentation));
}

function duplicateOperationDocumentation() {
  const duplicateOperationId =
    validDocumentation.screens[0]?.materialization.operationId;
  if (!duplicateOperationId) {
    throw new Error("Test fixture needs a committed first screen.");
  }
  const screens = validDocumentation.screens.map((screenItem, index) => ({
    ...screenItem,
    materialization:
      index === 1
        ? {
            ...screenItem.materialization,
            operationId: duplicateOperationId,
            traceRef: screenItem.materialization.traceRef
              ? {
                  ...screenItem.materialization.traceRef,
                  operationId: duplicateOperationId,
                }
              : null,
          }
        : screenItem.materialization,
  }));
  const refs = validDocumentation.trace.refs.map((reference, index) =>
    index === 1
      ? { ...reference, operationId: duplicateOperationId }
      : reference,
  );
  return parseWorkspaceDocumentation({
    ...structuredClone(validDocumentation),
    screens,
    trace: { ...validDocumentation.trace, refs },
    documentationDigest:
      "sha256:81397cb5f7677d65dd18d9236fcd99516392aad2bc36f85b19e7dffe67092b3a",
  });
}

describe("WorkspaceDocumentation browser consumer", () => {
  it("shows explicit loading state before rendering a valid artifact", async () => {
    let resolveLoader: ((value: unknown) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    render(<WorkspaceDocumentationConsumer loader={loader} />);

    expect(screen.getByRole("status", { name: "Documentation loading" })).toBeTruthy();
    resolveLoader?.(structuredClone(validDocumentation));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Workspace documentation",
      }),
    ).toBeTruthy();
  });

  it("fails closed for malformed injected artifacts", async () => {
    render(
      <WorkspaceDocumentationConsumer
        loader={() =>
          Promise.resolve({
            ...structuredClone(validDocumentation),
            documentationDigest: "sha256:".padEnd(71, "0"),
          })
        }
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Documentation unavailable")).toBeTruthy();
    expect(alert.textContent).toMatch(/invalid|unsafe|digest/i);
    expect(screen.queryByRole("table", { name: "Responsive screen matrix" })).toBeNull();
  });

  it("reports zero verified screenshots without upgrading committed canvas truth", async () => {
    render(<WorkspaceDocumentationConsumer loader={successfulLoader} />);

    const coverage = await screen.findByRole("status", {
      name: "Workspace evidence summary",
    });
    expect(within(coverage).getByText("0 verified screenshots")).toBeTruthy();
    expect(within(coverage).getByText("3 committed canvas cells")).toBeTruthy();
    expect(within(coverage).getByText("3 inferred captures")).toBeTruthy();

    const matrix = screen.getByRole("table", {
      name: "Responsive screen matrix",
    });
    expect(
      within(matrix).getByRole("button", {
        name: /Home default Desktop.*Inferred capture.*Committed canvas/,
      }),
    ).toBeTruthy();
    expect(matrix.querySelector(".capture-cell__preview")).toBeNull();
    expect(screen.queryByText(/verified evidence/i)).toBeNull();
  });

  it("keeps responsive matrix keyboard navigation and selection accessible", async () => {
    render(<WorkspaceDocumentationConsumer loader={successfulLoader} />);

    const desktop = await screen.findByRole("button", {
      name: /Home default Desktop.*Inferred capture/,
    });
    const tablet = screen.getByRole("button", {
      name: /Home default Tablet.*Inferred capture/,
    });
    const mobile = screen.getByRole("button", {
      name: /Home default Mobile.*Inferred capture/,
    });

    desktop.focus();
    fireEvent.keyDown(desktop, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tablet);
    fireEvent.keyDown(tablet, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(desktop);
    fireEvent.keyDown(desktop, { key: "ArrowDown" });
    expect(document.activeElement).toBe(desktop);
    fireEvent.keyDown(desktop, { key: "ArrowUp" });
    expect(document.activeElement).toBe(desktop);
    fireEvent.keyDown(desktop, { key: "PageDown" });
    expect(document.activeElement).toBe(desktop);
    fireEvent.keyDown(tablet, { key: " " });
    expect(tablet.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(desktop, { key: "Enter" });
    expect(desktop.getAttribute("aria-pressed")).toBe("true");
    desktop.focus();
    fireEvent.keyDown(desktop, { key: "ArrowRight" });
    fireEvent.keyDown(tablet, { key: "End" });
    expect(document.activeElement).toBe(mobile);
    fireEvent.keyDown(mobile, { key: "Home" });
    expect(document.activeElement).toBe(desktop);

    fireEvent.click(tablet);
    const detail = screen.getByRole("region", { name: "Selected screen evidence" });
    expect(within(detail).getByText("Tablet · 834 × 1112")).toBeTruthy();
    expect(within(detail).getByText("Committed canvas")).toBeTruthy();
    expect(within(detail).getByText("Inferred capture")).toBeTruthy();
  });

  it("navigates declared, not-observed flows without claiming execution", async () => {
    render(<WorkspaceDocumentationConsumer loader={successfulLoader} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Flows",
      }),
    );

    const view = screen.getByRole("region", { name: "Flows" });
    expect(within(view).getByRole("heading", { name: "Primary navigation" })).toBeTruthy();
    expect(within(view).getByText("Declared")).toBeTruthy();
    expect(within(view).getByText("Not observed")).toBeTruthy();
    expect(within(view).getByText("flow-start")).toBeTruthy();
    expect(within(view).queryByText(/passed|verified/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Screens" }));
    expect(
      screen.getByRole("region", { name: "Screens" }),
    ).toBeTruthy();
  });

  it("renders token identifiers as text and makes component unavailability explicit", async () => {
    render(<WorkspaceDocumentationConsumer loader={successfulLoader} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Design system",
      }),
    );

    const view = screen.getByRole("region", { name: "Design system" });
    expect(within(view).getByText("--color-canvas").tagName).toBe("CODE");
    expect(
      within(view).getAllByText("src/styles/tokens.css"),
    ).toHaveLength(validDocumentation.designSystem.tokens.length);
    expect(within(view).getByText("Components unavailable")).toBeTruthy();
    expect(within(view).getByText("0 available components")).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--color-canvas")).toBe("");
  });

  it("uses canonical trace references to select their exact screen evidence", async () => {
    render(<WorkspaceDocumentationConsumer loader={successfulLoader} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Evidence",
      }),
    );
    const evidence = screen.getByRole("region", { name: "Evidence" });
    fireEvent.click(
      within(evidence).getByRole("button", {
        name: "Inspect canonical event 2",
      }),
    );

    const selected = within(evidence).getByRole("region", {
      name: "Selected screen evidence",
    });
    expect(within(selected).getByText("Tablet · 834 × 1112")).toBeTruthy();
    expect(within(selected).getByText(/evt_4MYBPAWT/)).toBeTruthy();
  });

  it("selects by canonical event identity when operation IDs are duplicated", async () => {
    const documentation = duplicateOperationDocumentation();
    render(
      <WorkspaceDocumentationConsumer
        loader={() => Promise.resolve(documentation)}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Evidence",
      }),
    );
    const evidence = screen.getByRole("region", { name: "Evidence" });
    fireEvent.click(
      within(evidence).getByRole("button", {
        name: "Inspect canonical event 2",
      }),
    );

    const selected = within(evidence).getByRole("region", {
      name: "Selected screen evidence",
    });
    expect(within(selected).getByText("Tablet · 834 × 1112")).toBeTruthy();
    expect(within(selected).getByText(/evt_4MYBPAWT/)).toBeTruthy();
  });

  it("keeps optional collaboration state outside the canonical trace", async () => {
    render(
      <WorkspaceDocumentationConsumer
        collaboration={{
          title: "Review responsive import",
          status: "Awaiting review",
          harness: "Codex",
        }}
        loader={successfulLoader}
      />,
    );

    expect(await screen.findByRole("complementary", { name: "Collaboration" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    const trace = screen.getByRole("list", { name: "Canonical trace" });
    expect(within(trace).getAllByRole("listitem")).toHaveLength(3);
    expect(trace.textContent).not.toContain("Review responsive import");
    expect(trace.textContent).not.toContain("Codex");
  });
});

describe("WorkspaceDocumentation fetch loader", () => {
  it("validates a successful JSON response", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(validDocumentation), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      fetchWorkspaceDocumentation("/workspace.json", fetcher),
    ).resolves.toEqual(validDocumentation);
    expect(fetcher).toHaveBeenCalledWith(
      "/workspace.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects malformed and oversized response bodies before rendering", async () => {
    const malformedFetch = vi.fn(() =>
      Promise.resolve(new Response('{"kind":"workspace-documentation"}')),
    );
    const invalidJsonFetch = vi.fn(() =>
      Promise.resolve(new Response("{")),
    );
    const declaredOversizedFetch = vi.fn(() =>
      Promise.resolve(
        new Response("small", {
          headers: { "content-length": "1048577" },
        }),
      ),
    );
    const oversizedFetch = vi.fn(() =>
      Promise.resolve(new Response("x".repeat(1_048_577))),
    );

    await expect(
      fetchWorkspaceDocumentation("/malformed.json", malformedFetch),
    ).rejects.toThrow(/invalid|unsafe/i);
    await expect(
      fetchWorkspaceDocumentation("/invalid-json.json", invalidJsonFetch),
    ).rejects.toThrow(/invalid JSON/i);
    await expect(
      fetchWorkspaceDocumentation(
        "/declared-oversized.json",
        declaredOversizedFetch,
      ),
    ).rejects.toThrow(/exceeds 1048576 bytes/i);
    await expect(
      fetchWorkspaceDocumentation("/oversized.json", oversizedFetch),
    ).rejects.toThrow(/exceeds 1048576 bytes/i);
  });

  it("cancels a chunked response as soon as its body crosses the byte limit", async () => {
    const cancel = vi.fn();
    let chunk = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull(controller) {
          chunk += 1;
          controller.enqueue(new Uint8Array(600_000));
          if (chunk === 3) {
            controller.close();
          }
        }
      },
      { highWaterMark: 0 },
    );
    const streamingFetch = vi.fn(() =>
      Promise.resolve(new Response(stream)),
    );

    render(
      <WorkspaceDocumentationConsumer
        loader={() =>
          fetchWorkspaceDocumentation("/streaming.json", streamingFetch)
        }
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /exceeds 1048576 bytes/i,
    );
    expect(cancel).toHaveBeenCalledWith(
      "Workspace documentation byte limit exceeded.",
    );
    expect(chunk).toBe(2);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("surfaces HTTP and network failures as explicit error states", async () => {
    const httpFetch = vi.fn(() =>
      Promise.resolve(new Response("missing", { status: 404 })),
    );
    await expect(
      fetchWorkspaceDocumentation("/missing.json", httpFetch),
    ).rejects.toThrow(/HTTP 404/);

    render(
      <WorkspaceDocumentationConsumer
        loader={() => Promise.reject(new Error("Network unavailable"))}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Network unavailable");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("uses a safe generic message for non-Error loader failures", async () => {
    render(
      <WorkspaceDocumentationConsumer
        loader={() => Promise.reject("opaque failure")}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Workspace documentation could not be loaded.",
    );
  });
});

describe("production browser boundary", () => {
  it("does not ship the demo project from main", async () => {
    const mainSource = await import("./main.tsx?raw").then(
      (module) => module.default,
    );

    expect(mainSource).not.toContain("demo-project");
    expect(mainSource).not.toContain("demoProject");
    expect(mainSource).toContain("WorkspaceDocumentationConsumer");
  });

  it("imports only the browser-safe workspace-documentation root at runtime", async () => {
    const productionSources = import.meta.glob("./*.{ts,tsx}", {
      eager: true,
      import: "default",
      query: "?raw",
    }) as Record<string, string>;

    const packageImports = Object.entries(productionSources)
      .filter(([path]) => !path.includes(".test."))
      .flatMap(([path, source]) => {
        const runtimeSource = source.replace(
          /import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?/gu,
          "",
        );
        return Array.from(
          runtimeSource.matchAll(/from\s+["'](@memi\/[^"']+)["']/gu),
          (match) => [path, match[1]] as const,
        );
      });

    expect(packageImports).toEqual([
      expect.arrayContaining(["./WorkspaceDocumentationConsumer.tsx"]),
    ]);
    expect(packageImports.every(([, specifier]) => specifier === "@memi/workspace-documentation")).toBe(true);
  });
});
