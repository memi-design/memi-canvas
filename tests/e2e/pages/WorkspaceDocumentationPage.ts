import { expect, type Locator, type Page } from "@playwright/test";

export type DocumentationView =
  | "Screens"
  | "Flows"
  | "Design system"
  | "Evidence";

export class WorkspaceDocumentationPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly summary: Locator;
  readonly matrix: Locator;
  readonly cells: Locator;
  readonly selectedEvidence: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", {
      level: 1,
      name: "Workspace documentation",
    });
    this.summary = page.getByRole("status", {
      name: "Workspace evidence summary",
    });
    this.matrix = page.getByRole("table", {
      name: "Responsive screen matrix",
    });
    this.cells = page.locator("[data-documentation-cell]");
    this.selectedEvidence = page.getByRole("region", {
      name: "Selected screen evidence",
    });
  }

  async goto(): Promise<void> {
    await this.page.goto("/?view=documentation");
    await expect(this.heading).toBeVisible();
  }

  async openView(view: DocumentationView): Promise<void> {
    await this.page
      .getByRole("navigation", { name: "Project navigation" })
      .getByRole("button", { name: view })
      .click();
    await expect(
      this.page.getByRole("region", { name: view, exact: true }),
    ).toBeVisible();
  }

  async rootOverflowPixels(): Promise<number> {
    return this.page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  }
}
