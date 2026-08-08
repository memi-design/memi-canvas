import { useEffect, useRef } from "react";

import type { WorkbenchNode } from "./model.js";

export interface WorkbenchNodeReservation {
  readonly get: () => readonly WorkbenchNode[];
  readonly getScope: () => string;
  readonly isScopeCurrent: (scope: string) => boolean;
  readonly set: (nodes: readonly WorkbenchNode[]) => void;
}

/** Keeps optimistic IDs reserved until the canonical V3 revision advances. */
export function useWorkbenchNodeReservation(
  nodes: readonly WorkbenchNode[],
  revision: number,
  scope = "canvas",
): WorkbenchNodeReservation {
  const nodesRef = useRef(nodes);
  const activeRef = useRef(false);
  const revisionRef = useRef(revision);
  const scopeRef = useRef(scope);
  const reservationRef = useRef<WorkbenchNodeReservation>(null);
  if (revisionRef.current !== revision || scopeRef.current !== scope) {
    nodesRef.current = nodes;
    revisionRef.current = revision;
    scopeRef.current = scope;
  }
  reservationRef.current ??= {
    get: () => nodesRef.current,
    getScope: () => scopeRef.current,
    isScopeCurrent: (candidate) =>
      activeRef.current && scopeRef.current === candidate,
    set: (next) => {
      nodesRef.current = next;
    },
  };
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  return reservationRef.current;
}
