import type { ReactNode } from "react";

export type HomeIconName =
  | "alert"
  | "archive"
  | "check"
  | "clock"
  | "copy"
  | "design"
  | "draft"
  | "grid"
  | "import"
  | "list"
  | "moon"
  | "projects"
  | "scan"
  | "search"
  | "settings"
  | "sun"
  | "sync"
  | "templates"
  | "trash"
  | "whiteboard";

const paths: Readonly<Record<HomeIconName, ReactNode>> = {
  alert: (
    <>
      <path d="M12 4 3.5 19h17L12 4Z" />
      <path d="M12 9v4M12 16.5v.1" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h16v13H4V7Z" />
      <path d="M3 4h18v3H3V4ZM9 11h6" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  design: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 4v16M4 9h4" />
    </>
  ),
  draft: (
    <>
      <path d="M6 3h9l3 3v15H6V3Z" />
      <path d="M9 11h6M9 15h4M15 3v4h4" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  import: (
    <>
      <path d="M4 5h6l2 2h8v12H4V5Z" />
      <path d="M12 10v6M9.5 13.5 12 16l2.5-2.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="5" cy="6" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="5" cy="18" r="1" />
    </>
  ),
  moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
  projects: (
    <>
      <rect x="4" y="5" width="7" height="6" rx="1" />
      <rect x="13" y="5" width="7" height="6" rx="1" />
      <rect x="4" y="13" width="7" height="6" rx="1" />
      <rect x="13" y="13" width="7" height="6" rx="1" />
    </>
  ),
  scan: (
    <>
      <path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4 4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1-2-4-2 1a8 8 0 0 0-2-1l-.3-2h-5L9 6a8 8 0 0 0-2 1L5 6l-2 4 2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a8 8 0 0 0 2 1l.5 2h5l.5-2a8 8 0 0 0 2-1l2 1 2-4-2-1a7 7 0 0 0 .1-1Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </>
  ),
  sync: (
    <>
      <path d="M18 8a7 7 0 0 0-12-2L4 8" />
      <path d="M4 4v4h4M6 16a7 7 0 0 0 12 2l2-2" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  templates: (
    <>
      <path d="M5 4h14v16H5V4Z" />
      <path d="M9 4v16M9 9h10" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  whiteboard: (
    <>
      <circle cx="6" cy="7" r="2" />
      <rect x="15" y="5" width="4" height="4" rx=".5" />
      <path d="M8 7h7M17 9v4l-5 3H8" />
      <path d="m5 14 3 2-3 2-3-2 3-2Z" />
    </>
  ),
};

// Atomic Design: atom — one coherent monochrome icon family for the launcher.
export function HomeIcon({
  name,
  size = 16,
}: {
  readonly name: HomeIconName;
  readonly size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
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
