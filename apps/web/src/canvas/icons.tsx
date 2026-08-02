export type EditorIconName =
  | "activity"
  | "arrow"
  | "browser"
  | "chevron-down"
  | "chevron-right"
  | "code"
  | "circle"
  | "comment"
  | "component"
  | "context"
  | "cut"
  | "detach"
  | "duplicate"
  | "eye"
  | "fit"
  | "frame"
  | "group"
  | "hand"
  | "home"
  | "layers"
  | "line"
  | "lock"
  | "menu"
  | "paste"
  | "pen"
  | "pencil"
  | "plus"
  | "redo"
  | "route"
  | "search"
  | "scale"
  | "send"
  | "settings"
  | "section"
  | "slice"
  | "square"
  | "sticky"
  | "text"
  | "trash"
  | "undo"
  | "ungroup"
  | "unlock"
  | "cursor"
  | "zoom-in"
  | "zoom-out";

interface EditorIconProps {
  readonly name: EditorIconName;
  readonly size?: number;
}

// Atomic Design: atom — one lightweight, dependency-free editor glyph family.
export function EditorIcon({ name, size = 16 }: EditorIconProps) {
  const paths: Readonly<Record<EditorIconName, React.ReactNode>> = {
    activity: <path d="M3 12h3l2-6 4 12 2-6h7" />,
    arrow: (
      <>
        <path d="M4 20 20 4" />
        <path d="M12 4h8v8" />
      </>
    ),
    browser: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
      </>
    ),
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-right": <path d="m9 6 6 6-6 6" />,
    code: (
      <>
        <path d="m8 9-3 3 3 3" />
        <path d="m16 9 3 3-3 3" />
        <path d="m14 6-4 12" />
      </>
    ),
    circle: <circle cx="12" cy="12" r="8" />,
    comment: (
      <>
        <path d="M4 5h16v12H9l-5 4V5Z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    component: (
      <>
        <path d="m12 2 5 5-5 5-5-5 5-5Z" />
        <path d="m12 12 5 5-5 5-5-5 5-5Z" />
      </>
    ),
    context: (
      <>
        <path d="M12 3v18M3 12h18" />
        <circle cx="12" cy="12" r="8" />
      </>
    ),
    cut: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="m8.5 7.5 11 9M8.5 16.5l11-9" />
      </>
    ),
    detach: (
      <>
        <path d="m9 15-2 2a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0" />
        <path d="m15 9 2-2a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0" />
        <path d="m8 16 8-8" />
      </>
    ),
    duplicate: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="1" />
        <path d="M16 8V5H5v11h3" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    fit: (
      <>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      </>
    ),
    frame: (
      <>
        <path d="M5 3v18M19 3v18M3 5h18M3 19h18" />
      </>
    ),
    group: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1" />
        <rect x="13" y="13" width="7" height="7" rx="1" />
        <path d="M14 7h3v3M10 17H7v-3" />
      </>
    ),
    hand: (
      <path d="M7 11V6a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v7c0 5-3 8-8 8-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l2 2" />
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    line: <path d="M4 20 20 4" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    paste: (
      <>
        <path d="M8 5H5v16h13v-3" />
        <rect x="9" y="3" width="10" height="14" rx="1" />
        <path d="M12 7h4M12 11h4" />
      </>
    ),
    pen: (
      <>
        <path d="m4 20 5-1 10-10-4-4L5 15l-1 5Z" />
        <path d="m13 7 4 4M4 20l5-5" />
      </>
    ),
    pencil: (
      <>
        <path d="m4 19 1-5L16 3l5 5L10 19l-6 2v-2Z" />
        <path d="m13 6 5 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    redo: (
      <>
        <path d="m15 7 4 4-4 4" />
        <path d="M19 11H9a5 5 0 0 0-5 5v1" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 6h5a3 3 0 0 1 3 3v6" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    scale: (
      <>
        <path d="M8 3H3v5M16 21h5v-5" />
        <path d="m3 8 6-5M21 16l-6 5" />
        <rect x="7" y="7" width="10" height="10" rx="1" />
      </>
    ),
    send: (
      <>
        <path d="M12 20V5" />
        <path d="m6 11 6-6 6 6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1-2-4-2 1a8 8 0 0 0-2-1l-.3-2h-5L9 6a8 8 0 0 0-2 1L5 6l-2 4 2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a8 8 0 0 0 2 1l.5 2h5l.5-2a8 8 0 0 0 2-1l2 1 2-4-2-1a7 7 0 0 0 .1-1Z" />
      </>
    ),
    section: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M7 6.5h.01" />
      </>
    ),
    slice: (
      <>
        <path d="M4 4h11v11H4V4Z" />
        <path d="M9 9h11v11H9M15 4v5M4 15h5" />
      </>
    ),
    square: <rect x="4" y="4" width="16" height="16" rx="1" />,
    sticky: (
      <>
        <path d="M5 3h14v12l-6 6H5V3Z" />
        <path d="M13 21v-6h6" />
      </>
    ),
    text: <path d="M5 5h14M12 5v14M8 19h8" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" />
      </>
    ),
    undo: (
      <>
        <path d="m9 7-4 4 4 4" />
        <path d="M5 11h10a5 5 0 0 1 5 5v1" />
      </>
    ),
    ungroup: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <path d="m14 4 6 6M20 4l-6 6M4 14l6 6M10 14l-6 6" />
      </>
    ),
    unlock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M9 10V7a4 4 0 0 1 7-2" />
      </>
    ),
    cursor: <path d="m5 3 14 9-7 2-3 7L5 3Z" />,
    "zoom-in": (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6" />
      </>
    ),
    "zoom-out": (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5M7.5 10.5h6" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      data-icon={name}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}
