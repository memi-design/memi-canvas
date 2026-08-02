import type { ReactNode } from "react";

export type DockIconName =
  | "browser"
  | "collapse"
  | "expand"
  | "files"
  | "go"
  | "helium"
  | "inspect"
  | "reload"
  | "runs"
  | "settings"
  | "stop";

export function DockIcon({
  name,
  size = 16,
}: {
  readonly name: DockIconName;
  readonly size?: number;
}) {
  const paths: Readonly<Record<DockIconName, ReactNode>> = {
    browser: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </>
    ),
    collapse: <path d="m14 7-5 5 5 5" />,
    expand: <path d="m10 7 5 5-5 5" />,
    files: (
      <>
        <path d="M4 5h6l2 2h8v12H4Z" />
        <path d="M4 9h16" />
      </>
    ),
    go: <path d="m9 6 6 6-6 6" />,
    helium: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8 8v8M16 8v8M8 12h8" />
      </>
    ),
    inspect: (
      <>
        <path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    reload: (
      <>
        <path d="M19 8V4l-2 2a8 8 0 1 0 2.2 8" />
        <path d="M19 4h-4" />
      </>
    ),
    runs: (
      <>
        <path d="M4 17h3l2-8 4 10 2-6h5" />
        <path d="M4 5h16" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      </>
    ),
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  };

  return (
    <svg
      aria-hidden="true"
      data-dock-icon={name}
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
