import { useEffect, useRef } from "react";

import {
  mountProjectPreviewShader,
  projectShaderSeed,
} from "./projectPreviewShader.js";
import "./project-preview-pattern.css";

export interface ProjectPattern {
  readonly paletteId: "ruby";
  readonly seed: number;
}

interface ProjectPreviewPatternProps {
  readonly identity: string;
  readonly label: string;
}

export function createProjectPattern(identity: string): ProjectPattern {
  return Object.freeze({
    paletteId: "ruby",
    seed: projectShaderSeed(identity),
  });
}

// Atomic Design: atom — deterministic GPU artwork for a project record.
export function ProjectPreviewPattern({
  identity,
  label,
}: ProjectPreviewPatternProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pattern = createProjectPattern(identity);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    return mountProjectPreviewShader(canvas, pattern.seed, reducedMotion);
  }, [pattern.seed]);

  return (
    <span
      aria-label={label}
      className="project-preview-pattern"
      data-pattern-palette={pattern.paletteId}
      data-pattern-seed={pattern.seed}
      role="img"
    >
      <canvas
        aria-hidden="true"
        className="project-preview-pattern__canvas"
        data-renderer="webgl-fragment-shader"
        ref={canvasRef}
      />
      <span aria-hidden="true" className="project-preview-pattern__grain" />
    </span>
  );
}
