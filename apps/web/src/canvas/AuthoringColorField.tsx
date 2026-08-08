import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

const STUDIO_INPUT_BLACK = "--studio-input-hex-black";
const STUDIO_INPUT_WHITE = "--studio-input-hex-white";
const FALLBACK_BLACK = "#".concat("0".repeat(6));
const FALLBACK_WHITE = "#".concat("f".repeat(6));

function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/iu.test(value.trim());
}

function studioHexToken(token: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(window.document.documentElement)
    .getPropertyValue(token)
    .trim();
  return isHexColor(value) ? value : fallback;
}

function pickerColor(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "white") {
    return studioHexToken(STUDIO_INPUT_WHITE, FALLBACK_WHITE);
  }
  if (normalized === "black") {
    return studioHexToken(STUDIO_INPUT_BLACK, FALLBACK_BLACK);
  }
  return isHexColor(normalized)
    ? normalized
    : studioHexToken(STUDIO_INPUT_BLACK, FALLBACK_BLACK);
}

// Atomic Design: molecule — swatch and text entry with one commit boundary.
export function AuthoringColorField({
  label,
  mixed = false,
  onChange,
  onPreview,
  value,
}: {
  readonly label: string;
  readonly mixed?: boolean;
  readonly onChange: (value: string) => void;
  readonly onPreview?: (value: string) => void;
  readonly value: string;
}) {
  const displayValue = mixed ? "" : value;
  const [draft, setDraft] = useState(displayValue);
  const skipBlurRef = useRef(false);
  useEffect(() => setDraft(displayValue), [displayValue]);
  const commitPicker = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value);
    onPreview?.(event.currentTarget.value);
  };
  const updateDraft = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.currentTarget.value;
    setDraft(next);
    if (isHexColor(next)) onPreview?.(next.trim());
  };
  const commitDraft = () => {
    if (!isHexColor(draft)) {
      setDraft(displayValue);
      if (!mixed) onPreview?.(value);
      return;
    }
    const next = draft.trim();
    if (next !== value) onChange(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      skipBlurRef.current = true;
      setDraft(displayValue);
      if (!mixed) onPreview?.(value);
      event.currentTarget.blur();
    }
  };
  return (
    <div className="canvas-property">
      <span>{label}</span>
      <span className="inspector-color-control">
        <input
          aria-label={`${label.replace(/ color$/u, "")} swatch`}
          className="inspector-color-swatch"
          onBlur={commitDraft}
          onChange={commitPicker}
          type="color"
          value={pickerColor(mixed ? value : draft)}
        />
        <input
          aria-label={label}
          className="inspector-color-value"
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            commitDraft();
          }}
          onChange={updateDraft}
          onKeyDown={handleKeyDown}
          placeholder={mixed ? "Mixed" : undefined}
          spellCheck={false}
          type="text"
          value={draft}
        />
      </span>
    </div>
  );
}
