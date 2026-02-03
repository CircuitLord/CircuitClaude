import { useEffect, useRef, useCallback, useState } from "react";
import { useGitStore } from "../stores/gitStore";
import { useSessionStore } from "../stores/sessionStore";
import { GitFileEntry } from "../types";

const POLL_INTERVAL = 7000;
const DEFAULT_HEIGHT = 220;
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
  const { statuses, sectionOpen, fetchStatus, toggleSection, openDiff } = useGitStore();
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
              <div className="git-section-files">
                {totalCount === 0 ? (
                  <div className="git-empty">Working tree clean</div>
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
