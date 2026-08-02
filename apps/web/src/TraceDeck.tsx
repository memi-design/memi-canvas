import type { TraceEvent } from "./model";
import { titleCase } from "./model";
import { TruthBadge } from "./TruthBadge";

// Organism: a causal, human-readable activity log. It intentionally does not
// expose hidden reasoning or imitate a human cursor.
export function TraceDeck({
  events,
  onLocate,
}: {
  readonly events: readonly TraceEvent[];
  readonly onLocate: (captureId: string) => void;
}) {
  return (
    <section
      aria-label="Trace"
      aria-live="polite"
      className="trace-deck"
      data-workspace-region
      role="log"
      tabIndex={-1}
    >
      <div className="trace-deck__heading">
        <div>
          <p className="eyebrow">Causal history</p>
          <h2>Trace</h2>
        </div>
        <TruthBadge tone="neutral">Fixture-backed</TruthBadge>
      </div>
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            <div className="trace-event__meta">
              <span>{titleCase(event.type)}</span>
              <span>{titleCase(event.status)}</span>
            </div>
            <p>
              <span>{titleCase(event.actorKind)}</span>
              <strong>{event.actor}</strong>
            </p>
            <time>{event.timestamp}</time>
            {event.harness ? <span>Harness: {event.harness}</span> : null}
            <strong className="trace-event__action">{event.action}</strong>
            {event.targetLabel ? (
              <span>Target: {event.targetLabel}</span>
            ) : null}
            {event.targetCaptureId ? (
              <button
                aria-label={`Locate target for ${event.action}`}
                onClick={() => onLocate(event.targetCaptureId!)}
                type="button"
              >
                Locate target
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
