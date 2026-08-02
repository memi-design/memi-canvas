import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "../theme/studio-tokens.css";
import { HomeIcon, type HomeIconName } from "./HomeIcon.js";
import { ProjectPreviewPattern } from "./ProjectPreviewPattern.js";
import { WorkspaceProfileMenu } from "./WorkspaceProfileMenu.js";
import "./project-home.css";
import "./project-home-menu.css";
import "./project-home-responsive.css";

export type HomeProjectKind = "design" | "whiteboard";
export type HomeProjectStatus = "attention" | "draft" | "ready" | "syncing";
export type ProjectHomeView = "projects" | "recents" | "templates";
export type ProjectHomeLayout = "grid" | "list";
export type ProjectHomeSort = "name" | "recent";
export type ProjectHomeAction =
  | "archive"
  | "delete"
  | "duplicate"
  | "rename"
  | "reveal";

export interface HomeProject {
  readonly id: string;
  readonly kind: HomeProjectKind;
  readonly name: string;
  readonly provenance: {
    readonly detail: string;
    readonly label: string;
  };
  readonly status: HomeProjectStatus;
  readonly thumbnail?: {
    readonly alt: string;
    readonly countLabel?: string;
    readonly coverage?: {
      readonly captured: number;
      readonly scenarios: number;
    };
    readonly fit?: "contain" | "cover";
    readonly gallery?: readonly {
      readonly alt: string;
      readonly src: string;
    }[];
    readonly presentation?: "generative-pattern" | "mobile-gallery";
    readonly src?: string;
  };
  readonly updatedAt: string;
  readonly updatedLabel: string;
}

export interface ProjectHomeProps {
  readonly enabledProjectActions?: readonly ProjectHomeAction[];
  readonly initialView?: ProjectHomeView;
  readonly onCreateProject: (kind: HomeProjectKind) => void;
  readonly onCreateLandingPageDemo?: () => void;
  readonly onImportFigma?: () => void;
  readonly onImportProject?: () => void;
  readonly onOpenProject: (projectId: string) => void;
  readonly onOpenSettings?: () => void;
  readonly onProjectAction?: (
    projectId: string,
    action: ProjectHomeAction,
  ) => void;
  readonly projects: readonly HomeProject[];
  readonly onProfileChange?: (profile: {
    readonly userName: string;
    readonly workspaceName: string;
  }) => void;
  readonly userName?: string;
  readonly workspaceName?: string;
}

interface ViewDefinition {
  readonly icon: HomeIconName;
  readonly id: ProjectHomeView;
  readonly label: string;
}

const views: readonly ViewDefinition[] = [
  { icon: "clock", id: "recents", label: "Recents" },
  { icon: "projects", id: "projects", label: "Projects" },
  { icon: "templates", id: "templates", label: "Templates" },
];

const statusLabels: Readonly<Record<HomeProjectStatus, string>> = {
  attention: "Needs attention",
  draft: "Draft",
  ready: "Ready",
  syncing: "Syncing",
};

function statusIcon(status: HomeProjectStatus): HomeIconName {
  if (status === "ready") {
    return "check";
  }
  if (status === "syncing") {
    return "sync";
  }
  if (status === "attention") {
    return "alert";
  }
  return "draft";
}

function projectAriaLabel(project: HomeProject): string {
  return `Open ${project.name}, ${project.kind}, ${statusLabels[project.status]}, ${project.provenance.label}`;
}

function captureSummary(
  countLabel: string | undefined,
  scenarioCount: number | undefined,
): string | undefined {
  if (scenarioCount !== undefined) {
    return `${scenarioCount} mobile states`;
  }
  if (countLabel === undefined) {
    return undefined;
  }
  return countLabel.replace(/\bscreens?\b/, "source-linked screens");
}

function moveProjectFocus(
  event: KeyboardEvent<HTMLButtonElement>,
) {
  const grid = event.currentTarget.closest("[data-project-grid]");
  const rawColumnCount =
    grid === null
      ? ""
      : globalThis
          .getComputedStyle(grid)
          .getPropertyValue("--project-grid-columns");
  const parsedColumnCount = Number.parseInt(rawColumnCount, 10);
  const columnCount =
    Number.isFinite(parsedColumnCount) && parsedColumnCount > 0
      ? parsedColumnCount
      : 3;
  const directionByKey: Readonly<Record<string, number>> = {
    ArrowDown: columnCount,
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columnCount,
  };
  const cards = Array.from(
    grid?.querySelectorAll<HTMLButtonElement>("[data-project-card]") ?? [],
  );
  const currentIndex = cards.indexOf(event.currentTarget);
  const direction = directionByKey[event.key];
  let nextIndex: number | undefined;

  if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = cards.length - 1;
  } else if (direction !== undefined) {
    nextIndex = Math.min(
      cards.length - 1,
      Math.max(0, currentIndex + direction),
    );
  }

  if (nextIndex !== undefined && nextIndex !== currentIndex) {
    event.preventDefault();
    cards[nextIndex]?.focus();
  }
}

// Atomic Design: molecule — a project identity, preview, and source record.
function ProjectCard({
  onContext,
  onOpen,
  project,
}: {
  readonly onContext: (
    event: ReactMouseEvent<HTMLButtonElement>,
    projectId: string,
  ) => void;
  readonly onOpen: (projectId: string) => void;
  readonly project: HomeProject;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(project.id);
      return;
    }
    moveProjectFocus(event);
  }

  const galleryImages =
    project.thumbnail?.presentation === "mobile-gallery" &&
    project.thumbnail.src !== undefined
      ? [
          {
            alt: project.thumbnail.alt,
            src: project.thumbnail.src,
          },
          ...(project.thumbnail.gallery ?? []),
        ]
      : [];
  const coverage = project.thumbnail?.coverage;
  const captureDetail = captureSummary(
    project.thumbnail?.countLabel,
    coverage?.scenarios,
  );
  const metadataLabel =
    captureDetail === undefined
      ? project.updatedLabel
      : `${project.updatedLabel} · ${captureDetail}`;

  return (
    <li>
      <button
        aria-label={projectAriaLabel(project)}
        className="project-home-card"
        data-project-kind={project.kind}
        data-project-status={project.status}
        data-project-card
        onClick={() => onOpen(project.id)}
        onContextMenu={(event) => onContext(event, project.id)}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <span
          aria-hidden={project.thumbnail === undefined ? true : undefined}
          className={`project-home-card__preview project-home-card__preview--${project.kind}`}
          data-preview-source={
            project.thumbnail === undefined
              ? "document"
              : project.thumbnail.presentation === "generative-pattern"
                ? "brand"
                : "capture"
          }
          data-preview-layout={project.thumbnail?.presentation}
        >
          {project.thumbnail?.presentation === "generative-pattern" ? (
            <ProjectPreviewPattern
              identity={project.name}
              label={project.thumbnail.alt}
            />
          ) : project.thumbnail?.presentation === "mobile-gallery" ? (
            <span className="project-home-card__mobile-stage">
              <span className="project-home-card__preview-badge">
                {coverage === undefined ||
                coverage.captured === coverage.scenarios
                  ? "Runtime verified"
                  : "Coverage partial"}
              </span>
              <span className="project-home-card__mobile-hero">
                <img
                  alt={galleryImages[0]?.alt}
                  className="project-home-card__mobile-hero-image"
                  src={galleryImages[0]?.src}
                />
              </span>
              <span className="project-home-card__mobile-stack">
                {galleryImages.slice(1, 3).map((image) => (
                  <span
                    className="project-home-card__mobile-stack-item"
                    key={image.src}
                  >
                    <img
                      alt={image.alt}
                      className="project-home-card__mobile-capture"
                      src={image.src}
                    />
                  </span>
                ))}
              </span>
              {project.thumbnail.countLabel ? (
                <span className="project-home-card__preview-count">
                  {project.thumbnail.countLabel}
                </span>
              ) : null}
            </span>
          ) : project.thumbnail?.src !== undefined ? (
            <img
              alt={project.thumbnail.alt}
              className={`project-home-card__thumbnail project-home-card__thumbnail--${project.thumbnail.fit ?? "cover"}`}
              src={project.thumbnail.src}
            />
          ) : project.kind === "design" ? (
            <>
              <i className="project-preview__rail" />
              <i className="project-preview__frame project-preview__frame--wide" />
              <i className="project-preview__frame project-preview__frame--small" />
              <i className="project-preview__panel" />
            </>
          ) : (
            <>
              <i className="board-preview__line board-preview__line--one" />
              <i className="board-preview__line board-preview__line--two" />
              <i className="board-preview__node board-preview__node--one" />
              <i className="board-preview__node board-preview__node--two" />
              <i className="board-preview__note" />
            </>
          )}
        </span>
        <span className="project-home-card__body">
          <span className="project-home-card__heading">
            <span className="project-home-card__title">{project.name}</span>
            {project.status === "draft" ? null : (
              <span
                className={`project-home-status project-home-status--${project.status}`}
              >
                <HomeIcon name={statusIcon(project.status)} size={13} />
                {statusLabels[project.status]}
              </span>
            )}
          </span>
          <span className="project-home-card__metadata">
            <time dateTime={project.updatedAt}>{metadataLabel}</time>
            {project.thumbnail?.countLabel ? (
              <span>{project.thumbnail.countLabel}</span>
            ) : null}
          </span>
          {coverage ? (
            <span className="project-home-card__coverage">
              <span>
                {coverage.captured} of {coverage.scenarios} runtime captures
              </span>
              <progress
                aria-label={`${project.name} screen capture progress`}
                max={coverage.scenarios}
                value={coverage.captured}
              />
            </span>
          ) : null}
          <span className="project-home-card__evidence">
            <HomeIcon name="import" size={13} />
            <span className="project-home-card__source">
              <strong>{project.provenance.label}</strong>
              <small title={project.provenance.detail}>
                {project.provenance.detail}
              </small>
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

interface CreateActionProps {
  readonly icon: HomeIconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly shortcut?: string;
}

// Atomic Design: molecule — a compact project workflow entry point.
function CreateAction({
  icon,
  label,
  onClick,
  shortcut,
}: CreateActionProps) {
  return (
    <button
      aria-label={
        label === "New design"
          ? "Create design project"
          : label === "New whiteboard"
            ? "Create whiteboard project"
            : label
      }
      className="project-create"
      onClick={onClick}
      type="button"
    >
      <span className="project-create__icon">
        <HomeIcon name={icon} size={16} />
      </span>
      <strong>{label}</strong>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

interface ProjectContextMenuProps {
  readonly enabledActions?: readonly ProjectHomeAction[];
  readonly onAction?: (
    projectId: string,
    action: ProjectHomeAction,
  ) => void;
  readonly onClose: () => void;
  readonly onOpen: (projectId: string) => void;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly project: HomeProject;
}

function ProjectContextMenu({
  enabledActions,
  onAction,
  onClose,
  onOpen,
  position,
  project,
}: ProjectContextMenuProps) {
  function route(action: ProjectHomeAction) {
    onAction?.(project.id, action);
    onClose();
  }

  async function copyName() {
    await globalThis.navigator.clipboard?.writeText(project.name);
    onClose();
  }

  return (
    <div
      aria-label={`${project.name} actions`}
      className="project-context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <button
        onClick={() => {
          onOpen(project.id);
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <HomeIcon name="design" size={15} />
        Open
      </button>
      <button onClick={() => void copyName()} role="menuitem" type="button">
        <HomeIcon name="copy" size={15} />
        Copy project name
      </button>
      <span role="separator" />
      {(
        [
          ["duplicate", "copy", "Duplicate"],
          ["rename", "draft", "Rename"],
          ["reveal", "projects", "Reveal in Finder"],
          ["archive", "archive", "Archive"],
          ["delete", "trash", "Delete permanently"],
        ] as const
      ).map(([action, icon, label]) => (
        <button
          disabled={
            onAction === undefined ||
            (enabledActions !== undefined &&
              !enabledActions.includes(action))
          }
          key={action}
          onClick={() => route(action)}
          role="menuitem"
          type="button"
        >
          <HomeIcon name={icon} size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}

function EmptyProjects({
  onClear,
  query,
}: {
  readonly onClear: () => void;
  readonly query: string;
}) {
  return (
    <section className="project-home-empty">
      <span>
        <HomeIcon name="search" size={20} />
      </span>
      <h2>{query === "" ? "No projects yet" : `No projects match “${query}”`}</h2>
      <p>
        {query === ""
          ? "Create a blank canvas or import a repository to begin."
          : "Try a project name, source, or status."}
      </p>
      {query === "" ? null : (
        <button onClick={onClear} type="button">
          Clear project search
        </button>
      )}
    </section>
  );
}

function viewHeading(view: ProjectHomeView): string {
  if (view === "projects") {
    return "All projects";
  }
  if (view === "templates") {
    return "Start from a template";
  }
  return "Recent work";
}

// Atomic Design: page — local-first project launcher and creation surface.
export function ProjectHome({
  enabledProjectActions,
  initialView = "recents",
  onCreateProject,
  onCreateLandingPageDemo,
  onImportFigma,
  onImportProject,
  onOpenProject,
  onProfileChange,
  onOpenSettings,
  onProjectAction,
  projects,
  userName = "Designer",
  workspaceName = "Memi",
}: ProjectHomeProps) {
  const [view, setView] = useState<ProjectHomeView>(initialView);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<ProjectHomeLayout>("grid");
  const [sort, setSort] = useState<ProjectHomeSort>("recent");
  const [contextMenu, setContextMenu] = useState<{
    readonly projectId: string;
    readonly x: number;
    readonly y: number;
  }>();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(() => {
    const sortedProjects = [...projects].sort((first, second) =>
      sort === "name"
        ? first.name.localeCompare(second.name)
        : second.updatedAt.localeCompare(first.updatedAt),
    );
    if (normalizedQuery === "") {
      return sortedProjects;
    }
    return sortedProjects.filter((project) =>
      [
        project.name,
        project.kind,
        project.provenance.detail,
        project.provenance.label,
        statusLabels[project.status],
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, projects, sort]);
  const showTemplates = view === "templates" && normalizedQuery === "";
  const contextProject = projects.find(
    ({ id }) => id === contextMenu?.projectId,
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(undefined);
  }, []);

  useEffect(() => {
    globalThis.document.documentElement.dataset.studioTheme = theme;
  }, [theme]);

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((!event.metaKey && !event.ctrlKey) || event.repeat) {
        return;
      }
      const key = event.key.toLocaleLowerCase();
      if (key === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (key === "n") {
        event.preventDefault();
        onCreateProject(event.shiftKey ? "whiteboard" : "design");
      }
    }

    globalThis.addEventListener("keydown", handleShortcut);
    return () => globalThis.removeEventListener("keydown", handleShortcut);
  }, [onCreateProject]);

  useEffect(() => {
    if (contextMenu === undefined) {
      return;
    }
    function handleDismiss(event: globalThis.KeyboardEvent | MouseEvent) {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") {
        return;
      }
      closeContextMenu();
    }
    globalThis.addEventListener("keydown", handleDismiss);
    globalThis.addEventListener("pointerdown", handleDismiss);
    return () => {
      globalThis.removeEventListener("keydown", handleDismiss);
      globalThis.removeEventListener("pointerdown", handleDismiss);
    };
  }, [closeContextMenu, contextMenu]);

  return (
    <div
      className="project-home"
      data-studio-theme={theme}
      data-testid="project-home"
      data-theme={theme}
    >
      <aside className="project-home-sidebar">
        <header className="project-home-brand">
          <img
            alt=""
            className="project-home-brand__icon"
            src="/memi-canvas-icon.png"
          />
          <span>
            <strong>Memi</strong>
            <small>Design workspace</small>
          </span>
        </header>

        <label className="project-home-search">
          <HomeIcon name="search" size={15} />
          <span className="project-home-sr-only">Search projects</span>
          <input
            aria-label="Search projects"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            ref={searchInputRef}
            type="search"
            value={query}
          />
          <kbd>⌘K</kbd>
        </label>

        <nav aria-label="Home">
          {views.map((item) => (
            <button
              aria-label={item.label}
              aria-current={view === item.id ? "page" : undefined}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <HomeIcon name={item.icon} size={16} />
              {item.label}
              {item.id === "projects" ? <small>{projects.length}</small> : null}
            </button>
          ))}
        </nav>

        <section className="project-home-workspace">
          <span>Workspace</span>
          <strong>{workspaceName}</strong>
          <small>Local-first · Private</small>
        </section>

        <footer className="project-home-sidebar__footer">
          <WorkspaceProfileMenu
            {...(onProfileChange === undefined
              ? {}
              : { onChange: onProfileChange })}
            userName={userName}
            workspaceName={workspaceName}
          />
          {onOpenSettings ? (
            <button
              aria-label="Open settings"
              onClick={onOpenSettings}
              title="Settings"
              type="button"
            >
              <HomeIcon name="settings" size={16} />
            </button>
          ) : null}
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
            title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
            type="button"
          >
            <HomeIcon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
        </footer>
      </aside>

      <main className="project-home-main">
        <header className="project-home-topbar">
          <div>
            <span className="project-home-eyebrow">{workspaceName}</span>
            <h1>{normalizedQuery === "" ? viewHeading(view) : "Search"}</h1>
          </div>
        </header>

        {showTemplates ? null : (
          <section
            aria-labelledby="quick-start-title"
            className="project-quick-start"
          >
            <h2 className="project-home-sr-only" id="quick-start-title">
              Create or import
            </h2>
            <div className="project-quick-start__actions">
              <CreateAction
                icon="design"
                label="New design"
                onClick={() => onCreateProject("design")}
                shortcut="⌘N"
              />
              <CreateAction
                icon="whiteboard"
                label="New whiteboard"
                onClick={() => onCreateProject("whiteboard")}
                shortcut="⇧⌘N"
              />
              {onImportProject ? (
                <CreateAction
                  icon="import"
                  label="Import project"
                  onClick={onImportProject}
                />
              ) : null}
              {onImportFigma ? (
                <CreateAction
                  icon="scan"
                  label="Import from Figma"
                  onClick={onImportFigma}
                />
              ) : null}
            </div>
          </section>
        )}

        {showTemplates ? (
          <section aria-labelledby="templates-title" className="project-templates">
            <header>
              <h2 id="templates-title">Blank templates</h2>
              <p>Start clean. Add a source connection when you need one.</p>
            </header>
            <div>
              <CreateAction
                icon="design"
                label="New design"
                onClick={() => onCreateProject("design")}
                shortcut="⌘N"
              />
              <CreateAction
                icon="whiteboard"
                label="New whiteboard"
                onClick={() => onCreateProject("whiteboard")}
                shortcut="⇧⌘N"
              />
              {onCreateLandingPageDemo ? (
                <CreateAction
                  icon="templates"
                  label="Landing page demo"
                  onClick={onCreateLandingPageDemo}
                />
              ) : null}
            </div>
          </section>
        ) : visibleProjects.length === 0 ? (
          <EmptyProjects onClear={() => setQuery("")} query={query.trim()} />
        ) : (
          <section aria-labelledby="project-grid-title" className="project-list">
            <header>
              <div>
                <h2 id="project-grid-title">
                  {normalizedQuery === ""
                    ? view === "projects"
                      ? "Your projects"
                      : "Recently opened"
                    : `${visibleProjects.length} result${
                        visibleProjects.length === 1 ? "" : "s"
                      }`}
                </h2>
                <p>
                  Project status and source remain visible before you open a
                  canvas.
                </p>
              </div>
              <div className="project-list__controls">
                <label>
                  <span className="project-home-sr-only">Sort projects</span>
                  <select
                    aria-label="Sort projects"
                    onChange={(event) =>
                      setSort(event.target.value as ProjectHomeSort)
                    }
                    value={sort}
                  >
                    <option value="recent">Last modified</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <span aria-label="Project layout" role="group">
                  <button
                    aria-label="Grid view"
                    aria-pressed={layout === "grid"}
                    onClick={() => setLayout("grid")}
                    title="Grid view"
                    type="button"
                  >
                    <HomeIcon name="grid" size={15} />
                  </button>
                  <button
                    aria-label="List view"
                    aria-pressed={layout === "list"}
                    onClick={() => setLayout("list")}
                    title="List view"
                    type="button"
                  >
                    <HomeIcon name="list" size={15} />
                  </button>
                </span>
              </div>
            </header>
            <ul
              aria-label={
                view === "recents" ? "Recent projects" : "Project results"
              }
              className={`project-home-grid project-home-grid--${layout}`}
              data-project-count={visibleProjects.length}
              data-project-grid
            >
              {visibleProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  onContext={(event, projectId) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({
                      projectId,
                      x: Math.max(
                        8,
                        Math.min(event.clientX, globalThis.innerWidth - 222),
                      ),
                      y: Math.max(
                        8,
                        Math.min(event.clientY, globalThis.innerHeight - 264),
                      ),
                    });
                  }}
                  onOpen={onOpenProject}
                  project={project}
                />
              ))}
            </ul>
            {contextProject ? (
              <ProjectContextMenu
                {...(enabledProjectActions === undefined
                  ? {}
                  : { enabledActions: enabledProjectActions })}
                {...(onProjectAction ? { onAction: onProjectAction } : {})}
                onClose={closeContextMenu}
                onOpen={onOpenProject}
                position={{
                  x: contextMenu?.x ?? 8,
                  y: contextMenu?.y ?? 8,
                }}
                project={contextProject}
              />
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
