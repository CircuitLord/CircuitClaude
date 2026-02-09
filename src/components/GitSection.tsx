import { useEffect, useRef, useState, useMemo } from "react";
import { useGitStore, fileKey } from "../stores/gitStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useFileTreeStore } from "../stores/fileTreeStore";
import { GitFileEntry } from "../types";
import { SegmentedControl } from "./SegmentedControl";
import { CommitDialog } from "./CommitDialog";
import { FileTreeView } from "./FileTreeView";
import { fileColorClass } from "../lib/files";

const POLL_INTERVAL = 7000;
const DEFAULT_RATIO = 0.5; // default to 50% of sidebar height
const MAX_RATIO = 0.7; // max 70% of sidebar height
const MIN_RATIO = 0.3; // min 30% of sidebar height when expanded
const MIN_HEIGHT = 38; // just the header
const MIN_LIST_HEIGHT = 80; // minimum space for project list above
const REVERT_CONFIRM_TIMEOUT = 3000;

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
      return "var(--git-added)";
    case "S":
      return "var(--text-tertiary)";
    default:
      return "var(--text-tertiary)";
  }
}

export function displayStatus(status: string): string {
  if (status === "?") return "A";
  if (status === "S") return "~";
  return status;
}

function splitPath(filePath: string): { dir: string; name: string } {
  const sep = filePath.lastIndexOf("/");
  if (sep === -1) return { dir: "", name: filePath };
  return { dir: filePath.slice(0, sep + 1), name: filePath.slice(sep + 1) };
}

/* ---- Checkbox component ---- */

function FileCheckbox({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      className={`git-file-checkbox${checked ? " git-file-checkbox--checked" : ""}`}
      onClick={onClick}
    >
      {checked ? "[x]" : "[ ]"}
    </span>
  );
}

function GroupCheckbox({
  files,
}: {
  files: GitFileEntry[];
}) {
  const { selectedFiles, selectAllInGroup, deselectAllInGroup } = useGitStore();
  const selectedCount = files.filter((f) => selectedFiles[fileKey(f)]).length;
  const allSelected = selectedCount === files.length && files.length > 0;
  const partial = selectedCount > 0 && !allSelected;

  const label = allSelected ? "[x]" : partial ? "[-]" : "[ ]";
  const className = `git-group-checkbox${allSelected ? " git-group-checkbox--checked" : ""}${partial ? " git-group-checkbox--partial" : ""}`;

  return (
    <span
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        if (allSelected) {
          deselectAllInGroup(files);
        } else {
          selectAllInGroup(files);
        }
      }}
    >
      {label}
    </span>
  );
}

/* ---- Inline revert confirm ---- */

function RevertButton({
  onConfirm,
}: {
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (confirming) {
    return (
      <span className="git-revert-confirm">
        revert?{" "}
        <span
          className="git-revert-confirm-y"
          onClick={(e) => {
            e.stopPropagation();
            if (timerRef.current) clearTimeout(timerRef.current);
            setConfirming(false);
            onConfirm();
          }}
        >
          y
        </span>
        /
        <span
          className="git-revert-confirm-n"
          onClick={(e) => {
            e.stopPropagation();
            if (timerRef.current) clearTimeout(timerRef.current);
            setConfirming(false);
          }}
        >
          n
        </span>
      </span>
    );
  }

  return (
    <span
      className="git-file-revert-btn"
      title="Revert file"
      onClick={(e) => {
        e.stopPropagation();
        setConfirming(true);
        timerRef.current = setTimeout(() => setConfirming(false), REVERT_CONFIRM_TIMEOUT);
      }}
    >
      x
    </span>
  );
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
    const fileNodes = nodes.filter((n) => n.type === "file").sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      d.children = sortNodes(d.children);
    }
    return [...dirs, ...fileNodes];
  }

  return compactTree(sortNodes(root));
}

/** Collapse single-child directory chains into combined paths (e.g. "src/lib/") */
function compactTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.type === "file") return node;
    node.children = compactTree(node.children);
    while (node.children.length === 1 && node.children[0].type === "dir") {
      const child = node.children[0];
      node.name = node.name + "/" + child.name;
      node.fullPath = child.fullPath;
      node.children = child.children;
    }
    return node;
  });
}

function countFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

function collectFiles(node: TreeNode): GitFileEntry[] {
  if (node.type === "file" && node.file) return [node.file];
  return node.children.flatMap((c) => collectFiles(c));
}

/* ---- Tree view components ---- */

function TreeFileItem({
  node,
  depth,
  onFileClick,
  projectPath,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (file: GitFileEntry) => void;
  projectPath: string;
}) {
  const f = node.file!;
  const { selectedFiles, toggleFileSelection, revertFiles } = useGitStore();
  const isSelected = selectedFiles[fileKey(f)];

  return (
    <div
      className="git-file-item git-tree-file-item"
      style={{ paddingLeft: 12 + depth * 12 }}
      title={f.path}
      onClick={() => onFileClick(f)}
    >
      <span className="git-tree-spacer" />
      <FileCheckbox
        checked={isSelected}
        onClick={(e) => {
          e.stopPropagation();
          toggleFileSelection(f);
        }}
      />
      <span className="git-file-status" style={{ color: statusColor(f.status) }}>
        {displayStatus(f.status)}
      </span>
      <span className={`git-file-name ${fileColorClass(node.name)}`}>{node.name}</span>
      <RevertButton onConfirm={() => revertFiles(projectPath, [f])} />
    </div>
  );
}

function TreeDirNode({
  node,
  depth,
  onFileClick,
  projectPath,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (file: GitFileEntry) => void;
  projectPath: string;
}) {
  const { collapsedGroups, toggleGroup } = useGitStore();
  const key = `tree:${node.fullPath}`;
  const collapsed = collapsedGroups[key] ?? false;
  const count = countFiles(node);
  const dirFiles = useMemo(() => collectFiles(node), [node]);

  return (
    <div>
      <div
        className="git-tree-dir-header"
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => toggleGroup(key)}
      >
        <span className="git-group-chevron">{collapsed ? ">" : "v"}</span>
        <GroupCheckbox files={dirFiles} />
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
            projectPath={projectPath}
          />
        ))}
    </div>
  );
}

function TreeNodeRenderer({
  node,
  depth,
  onFileClick,
  projectPath,
}: {
  node: TreeNode;
  depth: number;
  onFileClick: (file: GitFileEntry) => void;
  projectPath: string;
}) {
  if (node.type === "dir") {
    return <TreeDirNode node={node} depth={depth} onFileClick={onFileClick} projectPath={projectPath} />;
  }
  return <TreeFileItem node={node} depth={depth} onFileClick={onFileClick} projectPath={projectPath} />;
}

const VIEW_MODE_OPTIONS: Array<{ label: string; value: "file" | "tree" }> = [
  { label: "file", value: "file" },
  { label: "tree", value: "tree" },
];

const PANEL_MODE_OPTIONS: Array<{ label: string; value: "source" | "files" }> = [
  { label: "~/files", value: "files" },
  { label: "~/source", value: "source" },
];

/* ---- Flat view components ---- */

function FileItem({
  file,
  dir,
  name,
  onFileClick,
  projectPath,
}: {
  file: GitFileEntry;
  dir: string;
  name: string;
  onFileClick: () => void;
  projectPath: string;
}) {
  const { selectedFiles, toggleFileSelection, revertFiles } = useGitStore();
  const isSelected = selectedFiles[fileKey(file)];

  return (
    <div
      className="git-file-item"
      title={file.path}
      onClick={onFileClick}
    >
      <FileCheckbox
        checked={isSelected}
        onClick={(e) => {
          e.stopPropagation();
          toggleFileSelection(file);
        }}
      />
      <span
        className="git-file-status"
        style={{ color: statusColor(file.status) }}
      >
        {displayStatus(file.status)}
      </span>
      <span className={`git-file-name ${fileColorClass(name)}`}>{name}</span>
      {dir && <span className="git-file-dir">{dir}</span>}
      <RevertButton onConfirm={() => revertFiles(projectPath, [file])} />
    </div>
  );
}

/* ---- Action Bar ---- */

function ActionBar({ projectPath }: { projectPath: string }) {
  const {
    selectedFiles,
    committing,
    reverting,
    statuses,
    revertFiles,
    openCommitDialog,
  } = useGitStore();
  const [revertConfirming, setRevertConfirming] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, []);

  const selCount = Object.keys(selectedFiles).length;
  const canOpenCommit = selCount > 0 && !committing;
  const canRevert = selCount > 0 && !reverting;

  const handleRevertClick = () => {
    if (!canRevert) return;
    setRevertConfirming(true);
    revertTimerRef.current = setTimeout(() => setRevertConfirming(false), REVERT_CONFIRM_TIMEOUT);
  };

  const handleRevertConfirm = () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setRevertConfirming(false);
    const status = statuses[projectPath];
    if (!status) return;
    const filesToRevert = status.files.filter((f) => selectedFiles[fileKey(f)]);
    revertFiles(projectPath, filesToRevert).catch(() => {});
  };

  const handleRevertCancel = () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setRevertConfirming(false);
  };

  return (
    <div className="git-action-bar">
      <div className="git-action-buttons">
        <button
          className="git-action-btn"
          disabled={!canOpenCommit}
          onClick={() => openCommitDialog(projectPath)}
        >
          :commit{selCount > 0 ? ` [${selCount}]` : ""}
        </button>
        {revertConfirming ? (
          <span className="git-revert-confirm git-revert-confirm--bar">
            revert?{" "}
            <span className="git-revert-confirm-y" onClick={handleRevertConfirm}>y</span>
            /
            <span className="git-revert-confirm-n" onClick={handleRevertCancel}>n</span>
          </span>
        ) : (
          <button
            className="git-action-btn git-action-btn--danger"
            disabled={!canRevert}
            onClick={handleRevertClick}
          >
            :revert{selCount > 0 ? ` [${selCount}]` : ""}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---- Main Component ---- */

export function GitSection() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { statuses, sectionOpen, fetchStatus, toggleSection, openDiff, viewMode, setViewMode, commitDialogOpen, closeCommitDialog } = useGitStore();
  const { settings, update: updateSettings } = useSettingsStore();
  const panelMode = settings.sidebarPanelMode;
  const { fetchDirectory, clearProject } = useFileTreeStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [heightRatio, setHeightRatio] = useState(DEFAULT_RATIO);
  const [parentHeight, setParentHeight] = useState(0);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Track parent (sidebar) height via ResizeObserver
  useEffect(() => {
    const el = sectionRef.current?.parentElement;
    if (!el) return;
    setParentHeight(el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setParentHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeProjectPath]);

  const panelHeight = parentHeight > 0
    ? Math.min(
        Math.max(parentHeight * MIN_RATIO, parentHeight * heightRatio),
        parentHeight * MAX_RATIO,
        parentHeight - MIN_LIST_HEIGHT
      )
    : MIN_HEIGHT;

  // Resize drag handling
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current || !sectionRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const parentEl = sectionRef.current.parentElement;
      const parentH = parentEl ? parentEl.clientHeight : 600;
      const minHeight = parentH * MIN_RATIO;
      const maxHeight = Math.min(parentH * MAX_RATIO, parentH - MIN_LIST_HEIGHT);
      const newHeight = Math.min(
        Math.max(minHeight, dragRef.current.startHeight + delta),
        maxHeight
      );
      setHeightRatio(newHeight / parentH);
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

  const status = activeProjectPath ? statuses[activeProjectPath] : undefined;
  const allFiles = status?.files ?? [];
  const treeNodes = useMemo(() => buildFileTree(allFiles), [allFiles]);

  if (!activeProjectPath) return null;

  const totalCount = allFiles.length;

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
        <span className="git-section-title" onClick={(e) => e.stopPropagation()}>
          <SegmentedControl
            value={panelMode}
            options={PANEL_MODE_OPTIONS}
            onChange={(v) => updateSettings({ sidebarPanelMode: v })}
          />
        </span>
        {panelMode === "source" && totalCount > 0 && (
          <span className="git-section-badge">[{totalCount}]</span>
        )}
        {panelMode === "source" && status?.branch && (
          <span className="git-branch-label">
            <span className="git-branch-prefix">@</span>
            {status.branch}
          </span>
        )}
        {panelMode === "files" && (
          <span
            className="git-branch-label"
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              clearProject();
              fetchDirectory(activeProjectPath);
            }}
          >
            :refresh
          </span>
        )}
      </div>
      {sectionOpen && <div className="sidebar-divider" />}
      {sectionOpen && panelMode === "source" && (
        <>
          <div className="git-section-body">
            {status && !status.isRepo ? (
              <div className="git-empty">Not a git repository</div>
            ) : status ? (
              <>
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
                        projectPath={activeProjectPath}
                      />
                    ))
                  ) : (
                    <div className="git-group">
                      <div className="git-group-header git-group-header--static">
                        <GroupCheckbox files={allFiles} />
                        <span className="git-group-label">Changes</span>
                        <span className="git-group-count">[{allFiles.length}]</span>
                      </div>
                      <div className="git-group-items">
                        {allFiles.map((f) => {
                          const { dir, name } = splitPath(f.path);
                          return (
                            <FileItem
                              key={f.path}
                              file={f}
                              dir={dir}
                              name={name}
                              onFileClick={() => openDiff(activeProjectPath, f)}
                              projectPath={activeProjectPath}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
          {totalCount > 0 && <ActionBar projectPath={activeProjectPath} />}
        </>
      )}
      {sectionOpen && panelMode === "files" && (
        <div className="git-section-body">
          <FileTreeView projectPath={activeProjectPath} />
        </div>
      )}
      <CommitDialog
        isOpen={commitDialogOpen}
        onClose={closeCommitDialog}
        projectPath={activeProjectPath}
      />
    </div>
  );
}
