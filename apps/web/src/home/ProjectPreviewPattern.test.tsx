import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createProjectPattern,
  ProjectPreviewPattern,
} from "./ProjectPreviewPattern.js";
import { fitShaderCanvasSize } from "./projectPreviewShader.js";

const acceptanceProjects = [
  "DoriOS",
  "Buzzr",
  "Nate the Bait",
  "Paraform",
  "dorii public site",
] as const;

describe("ProjectPreviewPattern", () => {
  it("derives a stable ruby shader seed from project identity", () => {
    const first = createProjectPattern("project-doriios");
    const second = createProjectPattern("project-doriios");
    const other = createProjectPattern("project-buzzr");

    expect(first).toEqual(second);
    expect(first.seed).not.toBe(other.seed);
    expect(first.paletteId).toBe("ruby");
    expect(other.paletteId).toBe("ruby");
  });

  it("gives every project distinct geometry while keeping one Memi ruby family", () => {
    const patterns = acceptanceProjects.map((project) =>
      createProjectPattern(project),
    );

    expect(new Set(patterns.map(({ seed }) => seed)).size).toBe(
      acceptanceProjects.length,
    );
    expect(new Set(patterns.map(({ paletteId }) => paletteId)).size).toBe(
      1,
    );
    expect(patterns.every(({ paletteId }) => paletteId === "ruby")).toBe(true);
  });

  it("fits the shader backing store to every card size while bounding pixel density", () => {
    expect(fitShaderCanvasSize(320, 180, 3)).toEqual({
      height: 360,
      pixelRatio: 2,
      width: 640,
    });
    expect(fitShaderCanvasSize(152, 106, 1)).toEqual({
      height: 106,
      pixelRatio: 1,
      width: 152,
    });
    expect(fitShaderCanvasSize(0, 0, 2)).toEqual({
      height: 1,
      pixelRatio: 2,
      width: 1,
    });
  });

  it("renders one scalable WebGL shader surface without vector or bitmap artwork", () => {
    render(
      <ProjectPreviewPattern
        identity="project-nate-the-bait"
        label="Nate the Bait generated project pattern"
      />,
    );

    const pattern = screen.getByRole("img", {
      name: "Nate the Bait generated project pattern",
    });
    const canvas = pattern.querySelector("canvas");

    expect(pattern.getAttribute("data-pattern-seed")).toMatch(/^\d+$/);
    expect(pattern.getAttribute("data-pattern-palette")).toBe("ruby");
    expect(canvas?.getAttribute("data-renderer")).toBe(
      "webgl-fragment-shader",
    );
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(pattern.querySelectorAll("img")).toHaveLength(0);
    expect(pattern.querySelectorAll("svg")).toHaveLength(0);
  });

  it("keeps every project preview to one GPU-backed drawing surface", () => {
    render(
      <ProjectPreviewPattern
        identity="project-doriios"
        label="DoriOS generated project pattern"
      />,
    );

    const pattern = screen.getByRole("img", {
      name: "DoriOS generated project pattern",
    });

    expect(pattern.querySelectorAll("canvas")).toHaveLength(1);
    expect(pattern.querySelectorAll("path, rect, circle")).toHaveLength(0);
  });
});
