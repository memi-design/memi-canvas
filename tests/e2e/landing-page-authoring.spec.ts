import { expect, test, type Locator, type Page } from "@playwright/test";

interface Point {
  readonly x: number;
  readonly y: number;
}

async function dragOnCanvas(
  page: Page,
  canvas: Locator,
  start: Point,
  end: Point,
) {
  const bounds = await canvas.boundingBox();
  if (bounds === null) {
    throw new Error("Infinite canvas is not visible");
  }
  await page.mouse.move(bounds.x + start.x, bounds.y + start.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + end.x, bounds.y + end.y, {
    steps: 4,
  });
  await page.mouse.up();
}

async function drawFrame(
  page: Page,
  canvas: Locator,
  name: string,
  start: Point,
  end: Point,
  fill: string,
) {
  const nodes = canvas.locator("[data-node-id]");
  const previousNodeCount = await nodes.count();
  await page.getByRole("button", { name: "Frame tool" }).click();
  await expect(canvas).toHaveAttribute("data-tool", "Frame");
  await dragOnCanvas(page, canvas, start, end);
  await expect(nodes).toHaveCount(previousNodeCount + 1);
  const frameBounds = nodes.nth(previousNodeCount);
  const frame = frameBounds.locator(".canvas-node__surface");
  await expect(frame).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Name").press("Enter");
  await page.getByLabel("Fill color").fill(fill);
  await page.getByLabel("Fill color").press("Enter");
  const renderedFrame = page.getByRole("button", {
    name: `${name} on canvas`,
  });
  await expect(
    renderedFrame,
  ).toBeVisible();
  await expect(frameBounds).toHaveCSS("left", `${start.x}px`);
  await expect(frameBounds).toHaveCSS("top", `${start.y}px`);
  await expect(frameBounds).toHaveCSS("width", `${end.x - start.x}px`);
  await expect(frameBounds).toHaveCSS("height", `${end.y - start.y}px`);
}

async function updateSelectedFrame(
  page: Page,
  name: string,
  start: Point,
  end: Point,
  fill: string,
) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Name").press("Enter");
  for (const [label, value] of [
    ["X", start.x],
    ["Y", start.y],
    ["Width", end.x - start.x],
    ["Height", end.y - start.y],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(String(value));
    await page.getByLabel(label, { exact: true }).press("Enter");
  }
  await page.getByLabel("Fill color").fill(fill);
  await page.getByLabel("Fill color").press("Enter");
  await expect(
    page.getByRole("button", { name: `${name} on canvas` }),
  ).toBeVisible();
}

async function drawText(
  page: Page,
  canvas: Locator,
  name: string,
  content: string,
  position: Point,
) {
  const nodes = canvas.locator("[data-node-id]");
  const previousNodeCount = await nodes.count();
  await page.getByRole("button", { name: "Text tool" }).click();
  await expect(canvas).toHaveAttribute("data-tool", "Text");
  await dragOnCanvas(
    page,
    canvas,
    { x: 600, y: 500 },
    { x: 780, y: 540 },
  );
  await expect(nodes).toHaveCount(previousNodeCount + 1);
  const text = nodes.nth(previousNodeCount).locator(".canvas-node__surface");
  await expect(text).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Name").press("Enter");
  await page.getByLabel("Text content").fill(content);
  await page.getByLabel("Text content").press("Enter");
  await page.getByLabel("X", { exact: true }).fill(String(position.x));
  await page.getByLabel("X", { exact: true }).press("Enter");
  await page.getByLabel("Y", { exact: true }).fill(String(position.y));
  await page.getByLabel("Y", { exact: true }).press("Enter");
  const renderedText = page.getByRole("button", {
    name: `${name} on canvas`,
  });
  await expect(renderedText).toContainText(content);
  await expect(renderedText.locator("xpath=..")).toHaveCSS(
    "left",
    `${position.x}px`,
  );
}

async function updateSelectedText(
  page: Page,
  name: string,
  content: string,
  position: Point,
) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Name").press("Enter");
  await page.getByLabel("Text content").fill(content);
  await page.getByLabel("Text content").press("Enter");
  await page.getByLabel("X", { exact: true }).fill(String(position.x));
  await page.getByLabel("X", { exact: true }).press("Enter");
  await page.getByLabel("Y", { exact: true }).fill(String(position.y));
  await page.getByLabel("Y", { exact: true }).press("Enter");
  await expect(
    page.getByRole("button", { name: `${name} on canvas` }),
  ).toContainText(content);
}

test("authors and reopens a responsive landing page through public editor commands", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The responsive document is authored inside the desktop editor surface.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Create design project" }).click();
  const canvas = page.getByRole("region", { name: "Infinite canvas" });

  await drawFrame(
    page,
    canvas,
    "Desktop landing",
    { x: 40, y: 100 },
    { x: 370, y: 370 },
    "#2b171d",
  );
  await page.keyboard.press("Meta+d");
  await updateSelectedFrame(
    page,
    "Tablet landing",
    { x: 410, y: 100 },
    { x: 640, y: 400 },
    "#161718",
  );
  await page.keyboard.press("Meta+d");
  await updateSelectedFrame(
    page,
    "Mobile landing",
    { x: 680, y: 100 },
    { x: 820, y: 380 },
    "#0f1011",
  );
  await drawText(
    page,
    canvas,
    "Desktop headline",
    "Design directly into production",
    { x: 100, y: 180 },
  );
  await page.keyboard.press("Meta+d");
  await updateSelectedText(
    page,
    "Tablet headline",
    "Canvas to code",
    { x: 470, y: 180 },
  );
  await page.keyboard.press("Meta+d");
  await updateSelectedText(
    page,
    "Mobile headline",
    "Build with Memi",
    { x: 720, y: 180 },
  );

  const mobileFrame = page.getByRole("button", {
    name: "Mobile landing on canvas",
  });
  await mobileFrame.click();
  await page.keyboard.press("Meta+d");
  await expect(
    page.getByRole("button", { name: "Mobile landing copy on canvas" }),
  ).toBeVisible();

  const desktopFrame = page.getByRole("button", {
    name: "Desktop landing on canvas",
  });
  await desktopFrame.click();
  await page.keyboard.press("Meta+c");
  await page.getByRole("button", { name: "Canvases" }).click();
  const initialCanvasButton = page.locator('nav[aria-label="Canvases"] button').first();
  const initialCanvasName = (await initialCanvasButton.textContent())?.trim() ?? "Migrated canvas";
  await page.getByRole("button", { name: "New canvas" }).click();
  await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("Meta+v");
  await expect(
    page.getByRole("button", { name: "Desktop landing copy on canvas" }),
  ).toBeVisible();

  await page.getByRole("button", { name: initialCanvasName }).click();
  await expect(desktopFrame).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mobile headline on canvas" }),
  ).toContainText("Build with Memi");
  await testInfo.attach("authored-responsive-landing-page", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.getByRole("button", { name: /Open Untitled design 1/iu }).click();
  await page.getByRole("button", { name: "Canvases" }).click();
  await expect(page.getByRole("button", { name: "Page 2" })).toBeVisible();
  await page.getByRole("button", { name: initialCanvasName }).click();
  await expect(
    page.getByRole("button", { name: "Desktop landing on canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tablet landing on canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mobile landing on canvas" }),
  ).toBeVisible();
});
