import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";

function useCommittedDraft<T extends string | number>(value: T, mixed = false) {
  const displayValue = mixed ? "" : String(value);
  const [draft, setDraft] = useState(displayValue);
  const editingRef = useRef(false);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraft(displayValue);
    }
  }, [displayValue]);

  return { draft, editingRef, setDraft, skipBlurRef };
}

function finishWithKeyboard(
  event: KeyboardEvent<HTMLInputElement>,
  commit: () => void,
  reset: () => void,
  skipBlurRef: MutableRefObject<boolean>,
) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    skipBlurRef.current = true;
    commit();
    event.currentTarget.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    skipBlurRef.current = true;
    reset();
    event.currentTarget.blur();
  }
}

export function AuthoringNumberField({
  label,
  minimum,
  mixed = false,
  onCommit,
  onPreview,
  value,
}: {
  readonly label: string;
  readonly minimum?: number;
  readonly mixed?: boolean;
  readonly onCommit: (value: number) => void;
  readonly onPreview?: (value: number) => void;
  readonly value: number;
}) {
  const { draft, editingRef, setDraft, skipBlurRef } =
    useCommittedDraft(value, mixed);
  const reset = () => {
    setDraft(mixed ? "" : String(value));
    if (!mixed) {
      onPreview?.(value);
    }
  };
  const preview = (nextDraft: string) => {
    if (nextDraft.trim() === "") {
      return;
    }
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      return;
    }
    onPreview?.(
      minimum === undefined ? parsed : Math.max(minimum, parsed),
    );
  };
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      reset();
      return;
    }
    const next = minimum === undefined ? parsed : Math.max(minimum, parsed);
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <label className="canvas-property">
      <span>{label}</span>
      <input
        aria-label={label}
        inputMode="decimal"
        onBlur={() => {
          editingRef.current = false;
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit();
        }}
        onFocus={() => {
          editingRef.current = true;
        }}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value;
          setDraft(nextDraft);
          preview(nextDraft);
        }}
        onKeyDown={(event) =>
          finishWithKeyboard(event, commit, reset, skipBlurRef)
        }
        placeholder={mixed ? "Mixed" : undefined}
        type="number"
        value={draft}
      />
    </label>
  );
}

export function AuthoringTextField({
  label,
  mixed = false,
  onCommit,
  value,
}: {
  readonly label: string;
  readonly mixed?: boolean;
  readonly onCommit: (value: string) => void;
  readonly value: string;
}) {
  const { draft, editingRef, setDraft, skipBlurRef } =
    useCommittedDraft(value, mixed);
  const reset = () => setDraft(mixed ? "" : value);
  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  return (
    <label className="canvas-property">
      <span>{label}</span>
      <input
        aria-label={label}
        onBlur={() => {
          editingRef.current = false;
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit();
        }}
        onFocus={() => {
          editingRef.current = true;
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) =>
          finishWithKeyboard(event, commit, reset, skipBlurRef)
        }
        placeholder={mixed ? "Mixed" : undefined}
        type="text"
        value={draft}
      />
    </label>
  );
}
