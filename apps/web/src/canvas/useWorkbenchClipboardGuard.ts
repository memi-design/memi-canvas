import { useEffect, useRef } from "react";

export interface WorkbenchClipboardGuard {
  readonly begin: () => number;
  readonly isCurrent: (generation: number) => boolean;
}

export function createWorkbenchClipboardGuard(): WorkbenchClipboardGuard {
  let generation = 0;
  return Object.freeze({
    begin: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (candidate: number) => candidate === generation,
  });
}

/** Invalidates pending clipboard work after a newer action or unmount. */
export function useWorkbenchClipboardGuard(): WorkbenchClipboardGuard {
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const guardRef = useRef<WorkbenchClipboardGuard>(null);
  guardRef.current ??= {
    begin: () => {
      generationRef.current += 1;
      return generationRef.current;
    },
    isCurrent: (candidate) =>
      activeRef.current && candidate === generationRef.current,
  };
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
    };
  }, []);
  return guardRef.current;
}
