import type { ReactNode } from "react";

export function WorkspaceDockEmptyState({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <p className="workspace-dock__empty">{children}</p>;
}
