// Atom: a compact, semantic truth label backed by product vocabulary.
export function TruthBadge({
  children,
  tone,
}: {
  readonly children: string;
  readonly tone: "neutral" | "positive" | "warning";
}) {
  return <span className={`truth-badge truth-badge--${tone}`}>{children}</span>;
}
