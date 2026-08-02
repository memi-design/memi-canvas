import { useMemo, useState } from "react";

import { EditorIcon } from "./icons.js";
import {
  filterProductMap,
  type ProductMap,
  type ProductMapAuthority,
  type ProductMapStatus,
} from "./product-map.js";
import "./product-map.css";

const authorityLabels: Readonly<Record<ProductMapAuthority, string>> = {
  cached: "Cached",
  "canvas-only": "Canvas-only",
  "immutable-evidence": "Evidence",
  proposal: "Proposal",
  "source-owned": "Source-owned",
};

const statusLabels: Readonly<Record<ProductMapStatus, string>> = {
  blocked: "Blocked",
  divergent: "Divergent",
  fresh: "Fresh",
  missing: "Missing",
  placeholder: "Placeholder",
  stale: "Stale",
  verified: "Verified",
};

// Atomic Design: organism — repository truth projected for visual exploration.
export function ProductMapPanel({
  map,
  onSelectNode,
  selectedNodeId,
}: {
  readonly map: ProductMap;
  readonly onSelectNode: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [authority, setAuthority] =
    useState<ProductMapAuthority | "all">("all");
  const [status, setStatus] =
    useState<ProductMapStatus | "all">("all");
  const filtered = useMemo(
    () => filterProductMap(map, { authority, query, status }),
    [authority, map, query, status],
  );

  return (
    <div className="product-map">
      <header className="product-map__header">
        <div>
          <h2>Product Map</h2>
          <span>{map.totalCount}</span>
        </div>
        <small>Repository</small>
      </header>
      <label className="product-map__search">
        <EditorIcon name="search" size={13} />
        <input
          aria-label="Search Product Map"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Routes, components, files…"
          type="search"
          value={query}
        />
      </label>
      <fieldset
        aria-label="Product Map filters"
        className="product-map__filters"
      >
        <legend>Filter repository</legend>
        <label>
          <span>Authority</span>
          <select
            aria-label="Product Map authority"
            onChange={(event) =>
              setAuthority(
                event.currentTarget.value as
                  | ProductMapAuthority
                  | "all",
              )
            }
            value={authority}
          >
            <option value="all">All authority</option>
            {Object.entries(authorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            aria-label="Product Map status"
            onChange={(event) =>
              setStatus(
                event.currentTarget.value as ProductMapStatus | "all",
              )
            }
            value={status}
          >
            <option value="all">All status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {filtered.groups.length === 0 ? (
        <div className="product-map__empty">
          <strong>No matching product evidence</strong>
          <p>Clear filters or scan a repository snapshot.</p>
        </div>
      ) : (
        <div className="product-map__groups">
          {filtered.groups.map((group) => (
            <details
              key={group.id}
              open={query.length > 0 || group.id === "components"}
            >
              <summary>
                <span>{group.label}</span>
                <small>{group.count}</small>
              </summary>
              <ul aria-label={`Product Map ${group.label}`}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      aria-pressed={item.nodeId === selectedNodeId}
                      disabled={item.nodeId === undefined}
                      onClick={() => {
                        if (item.nodeId !== undefined) {
                          onSelectNode(item.nodeId);
                        }
                      }}
                      title={`${authorityLabels[item.authority]} · ${statusLabels[item.status]}${item.sourcePath ? ` · ${item.sourcePath}` : ""}`}
                      type="button"
                    >
                      <EditorIcon
                        name={
                          group.id === "routes"
                            ? "frame"
                            : group.id === "components"
                              ? "component"
                              : group.id === "tokens"
                                ? "square"
                                : "route"
                        }
                        size={13}
                      />
                      <span className="product-map__item-label">
                        <strong>{item.label}</strong>
                        {item.sourcePath ? (
                          <small>{item.sourcePath}</small>
                        ) : null}
                      </span>
                      <span className="product-map__badges">
                        <i
                          aria-hidden="true"
                          data-authority={item.authority}
                          data-status={item.status}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
