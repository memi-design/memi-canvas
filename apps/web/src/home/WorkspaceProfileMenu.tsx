import { useEffect, useState } from "react";

export interface WorkspaceProfileMenuProps {
  readonly onChange?: (profile: {
    readonly userName: string;
    readonly workspaceName: string;
  }) => void;
  readonly userName: string;
  readonly workspaceName: string;
}

// Atomic Design: molecule — local profile and workspace identity controls.
export function WorkspaceProfileMenu({
  onChange,
  userName,
  workspaceName,
}: WorkspaceProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ userName, workspaceName });

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => globalThis.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function openMenu() {
    setDraft({ userName, workspaceName });
    setOpen(true);
  }

  function save() {
    const nextUserName = draft.userName.trim();
    const nextWorkspaceName = draft.workspaceName.trim();
    if (nextUserName === "" || nextWorkspaceName === "") return;
    onChange?.({
      userName: nextUserName,
      workspaceName: nextWorkspaceName,
    });
    setOpen(false);
  }

  return (
    <div className="workspace-profile-menu">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open profile"
        className="workspace-profile-menu__trigger"
        onClick={openMenu}
        type="button"
      >
        <span aria-hidden="true" className="project-home-avatar">
          {userName.slice(0, 1).toLocaleUpperCase()}
        </span>
        <span>
          <strong>{userName}</strong>
          <small>{workspaceName}</small>
        </span>
      </button>
      {open ? (
        <section
          aria-label="Workspace profile"
          className="workspace-profile-menu__panel"
          role="dialog"
        >
          <header>
            <strong>Local workspace</strong>
            <small>Stored on this Mac</small>
          </header>
          <label>
            <span>Display name</span>
            <input
              aria-label="Display name"
              maxLength={64}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  userName: event.target.value,
                }))
              }
              value={draft.userName}
            />
          </label>
          <label>
            <span>Workspace name</span>
            <input
              aria-label="Workspace name"
              maxLength={96}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  workspaceName: event.target.value,
                }))
              }
              value={draft.workspaceName}
            />
          </label>
          <footer>
            <button onClick={() => setOpen(false)} type="button">
              Cancel
            </button>
            <button onClick={save} type="button">
              Save profile
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
