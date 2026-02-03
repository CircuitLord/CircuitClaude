import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useGitStore } from "../stores/gitStore";
import { useSessionStore } from "../stores/sessionStore";
import { GitFileEntry } from "../types";
import { SegmentedControl } from "./SegmentedControl";

const POLL_INTERVAL = 7000;
const DEFAULT_HEIGHT = 190;
const MIN_HEIGHT = 38; // just the header
const MIN_LIST_HEIGHT = 80; // minimum space for project list above

export function statusColor(status: string): string {
  switch (status) {
    case "M":
      return "var(--git-modified)";
    case "A":
      return "var(--git-added)";
    case "D":
      return "var(--git-deleted)";
    case "R":
      return "var(--git-renamed)";
    case "?":
      return "var(--git-untracked)";
    default:
      return "var(--text-tertiary)";
  }
}

function splitPath(filePath: string): { dir: string; name: string } {
  const sep = filePath.lastIndexOf("/");
  if (sep === -1) return { dir: "", name: filePath };
  return { dir: filePath.slice(0, sep + 1), name: filePath.slice(sep + 1) };
}

/* ---- Tree view types & utilities ---- */

interface TreeNode {
  name: string;
  fullPath: string;
  type: "dir" | "file";
  children: TreeNode[];
  file?: GitFileEntry;
}

function buildFileTree(files: GitFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const f of files) {
    const parts = f.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === part && n.type === (isFile ? "file" : "dir"));
      if (!existing) {
        existing = {
          name: part,
          fullPath,
          type: isFile ? "file" : "dir",
          children: [],
          file: isFile ? f : undefined,
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    const dirs = nodes.filter((n) => n.type === "dir").sort((a, b) => a.name.localeCompare(b.name));
    const files = nodes.filter((n) => n.type === "file").sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      d.children = sortNodes(d.children);
    }
    return [...dirs, ...files];
  }

  return sortNodes(root);
}

function countFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

/* ---- Tree view components ---- */

function TreeFileItem({
  node,
  depth,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (file: GitFileEntry) => void;
}) {
  const f = node.file!;
  return (
    <div
      className="git-file-item git-tree-file-item"
      style={{ paddingLeft: 12 + depth * 12 }}
      title={f.path}
      onClick={() => onFileClick(f)}
    >
      <span className="git-file-status" style={{ color: statusColor(f.status) }}>
        {f.status}
      </span>
      <span className="git-file-name">{node.name}</span>
      {f.staged && <span className="git-tree-staged">S</span>}
    </div>
  );
}

function TreeDirNode({
  node,
  depth,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (file: GitFileEntry) => void;
}) {
  const { collapsedGroups, toggleGroup } = useGitStore();
  const key = `tree:${node.fullPath}`;
  const collapsed = collapsedGroups[key] ?? false;
  const count = countFiles(node);

  return (
    <div>
      <div
        className="git-tree-dir-header"
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => toggleGroup(key)}
      >
        <span className="git-group-chevron">{collapsed ? ">" : "v"}</span>
        <span className="git-tree-dir-name">{node.name}/</span>
        <span className="git-group-count">[{count}]</span>
      </div>
      {!collapsed &&
        node.children.map((child) => (
          <TreeNodeRenderer
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            onFileClick={onFileClick}
          />
        ))}
    </div>
  );
}

function TreeNodeRenderer({
  node,
  depth,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (file: GitFileEntry) => void;
}) {
  if (node.type === "dir") {
    return <TreeDirNode node={node} depth={depth} onFileClick={onFileClick} />;
  }
  return <TreeFileItem node={node} depth={depth} onFileClick={onFileClick} />;
}

const VIEW_MODE_OPTIONS: Array<{ label: string; value: "file" | "tree" }> = [
  { label: "file", value: "file" },
  { label: "tree", value: "tree" },
];

/* ---- Flat view components ---- */

function FileGroup({
  label,
  groupKey,
  files,
  onFileClick,
}: {
  label: string;
  groupKey: string;
  files: GitFileEntry[];
  onFileClick: (file: GitFileEntry) => void;
}) {
  const { collapsedGroups, toggleGroup } = useGitStore();
  const collapsed = collapsedGroups[groupKey] ?? false;

  if (files.length === 0) return null;

  return (
    <div className="git-group">
      <div className="git-group-header" onClick={() => toggleGroup(groupKey)}>
        <span className="git-group-chevron">{collapsed ? ">" : "v"}</span>
        <span className="git-group-label">{label}</span>
        <span className="git-group-count">[{files.length}]</span>
      </div>
      {!collapsed && (
        <div className="git-group-items">
          {files.map((f, i) => {
            const { dir, name } = splitPath(f.path);
            return (
              <div
                className="git-file-item"
                key={`${f.path}-${i}`}
                title={f.path}
                onClick={() => onFileClick(f)}
              >
                <span
                  className="git-file-status"
                  style={{ color: statusColor(f.status) }}
                >
                  {f.status}
                </span>
                <span className="git-file-name">{name}</span>
                {dir && <span className="git-file-dir">{dir}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GitSection() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { statuses, sectionOpen, fetchStatus, toggleSection, openDiff, viewMode, setViewMode } = useGitStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const refresh = useCallback(() => {
    if (activeProjectPath) fetchStatus(activeProjectPath);
  }, [activeProjectPath, fetchStatus]);

  // Resize drag handling
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current || !sectionRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const parentEl = sectionRef.current.parentElement;
      const maxHeight = parentEl
        ? parentEl.clientHeight - MIN_LIST_HEIGHT
        : 600;
      const newHeight = Math.min(
        Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta),
        maxHeight
      );
      setPanelHeight(newHeight);
    }

    function onMouseUp() {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: panelHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }

  // Fetch on mount / project change, and poll
  useEffect(() => {
    if (!activeProjectPath) return;

    fetchStatus(activeProjectPath);

    if (sectionOpen) {
      intervalRef.current = setInterval(() => {
        fetchStatus(activeProjectPath);
      }, POLL_INTERVAL);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeProjectPath, sectionOpen, fetchStatus]);

  if (!activeProjectPath) return null;

  const status = statuses[activeProjectPath];
  const staged = status?.files.filter((f) => f.staged) ?? [];
  const changes =
    status?.files.filter((f) => !f.staged && f.status !== "?") ?? [];
  const untracked =
    status?.files.filter((f) => !f.staged && f.status === "?") ?? [];
  const totalCount = staged.length + changes.length + untracked.length;
  const allFiles = status?.files ?? [];
  const treeNodes = useMemo(() => buildFileTree(allFiles), [allFiles]);

  return (
    <div
      className="git-section"
      ref={sectionRef}
      style={{ height: sectionOpen ? panelHeight : undefined }}
    >
      {sectionOpen && (
        <div className="git-resize-handle" onMouseDown={onResizeStart} />
      )}
      <div className="git-section-header" onClick={toggleSection}>
        <span className="git-section-chevron">{sectionOpen ? "v" : ">"}</span>
        <span className="git-section-title">~/source</span>
        {totalCount > 0 && (
          <span className="git-section-badge">[{totalCount}]</span>
        )}
        <button
          className="git-refresh-btn"
          onClick={(e) => {
            e.stopPropagation();
            refresh();
          }}
          title="Refresh"
        >
          ~
        </button>
      </div>
      {sectionOpen && <div className="sidebar-divider" />}
      {sectionOpen && (
        <div className="git-section-body">
          {status && !status.isRepo ? (
            <div className="git-empty">Not a git repository</div>
          ) : status ? (
            <>
              <div className="git-section-branch">
                <span className="git-branch-prefix">@</span>
                <span className="git-branch-name">{status.branch}</span>
              </div>
              {totalCount > 0 && (
                <div className="git-view-toggle">
                  <SegmentedControl
                    value={viewMode}
                    options={VIEW_MODE_OPTIONS}
                    onChange={setViewMode}
                  />
                </div>
              )}
              <div className="git-section-files">
                {totalCount === 0 ? (
                  <div className="git-empty">Working tree clean</div>
                ) : viewMode === "tree" ? (
                  treeNodes.map((node) => (
                    <TreeNodeRenderer
                      key={node.fullPath}
                      node={node}
                      depth={0}
                      onFileClick={(f) => openDiff(activeProjectPath, f)}
                    />
                  ))
                ) : (
                  <>
                    <FileGroup
                      label="Staged Changes"
                      groupKey="staged"
                      files={staged}
                      onFileClick={(f) => openDiff(activeProjectPath, f)}
                    />
                    <FileGroup
                      label="Changes"
                      groupKey="changes"
                      files={changes}
                      onFileClick={(f) => openDiff(activeProjectPath, f)}
                    />
                    <FileGroup
                      label="Untracked"
                      groupKey="untracked"
                      files={untracked}
                      onFileClick={(f) => openDiff(activeProjectPath, f)}
                    />
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
