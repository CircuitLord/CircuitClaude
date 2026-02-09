import { useEffect } from "react";
import { useFileTreeStore } from "../stores/fileTreeStore";
import { FileTreeEntry } from "../types";
import { fileColorClass } from "../lib/files";

function FileTreeFileNode({
  entry,
  depth,
}: {
  entry: FileTreeEntry;
  depth: number;
}) {
  return (
    <div
      className="filetree-file-item"
      style={{ paddingLeft: 12 + depth * 12 }}
    >
      <span className="filetree-spacer" />
      <span className={`filetree-file-name ${fileColorClass(entry.name)}`}>{entry.name}</span>
    </div>
  );
}

function FileTreeDirNode({
  entry,
  depth,
  projectPath,
}: {
  entry: FileTreeEntry;
  depth: number;
  projectPath: string;
}) {
  const { entries, expandedDirs, loading, toggleDir } = useFileTreeStore();
  const isExpanded = expandedDirs[entry.path] ?? false;
  const isLoading = loading[entry.path] ?? false;
  const children = entries[entry.path];

  const chevron = isLoading ? "~" : isExpanded ? "v" : ">";

  return (
    <div>
      <div
        className="filetree-dir-header"
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => toggleDir(projectPath, entry.path)}
      >
        <span className="filetree-chevron">{chevron}</span>
        <span className="filetree-dir-name">{entry.name}/</span>
      </div>
      {isExpanded && children && children.length === 0 && (
        <div className="git-empty" style={{ paddingLeft: 12 + (depth + 1) * 12 }}>
          Empty directory
        </div>
      )}
      {isExpanded &&
        children?.map((child) =>
          child.isDir ? (
            <FileTreeDirNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              projectPath={projectPath}
            />
          ) : (
            <FileTreeFileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
            />
          ),
        )}
    </div>
  );
}

export function FileTreeView({ projectPath }: { projectPath: string }) {
  const { entries, loading, fetchDirectory, clearProject } = useFileTreeStore();
  const rootEntries = entries[""] ?? [];
  const rootLoading = loading[""] ?? false;

  // Fetch root on mount / project change
  useEffect(() => {
    clearProject();
    fetchDirectory(projectPath);
  }, [projectPath, fetchDirectory, clearProject]);

  if (rootLoading && rootEntries.length === 0) {
    return <div className="git-empty">Loading...</div>;
  }

  if (rootEntries.length === 0) {
    return <div className="git-empty">Empty directory</div>;
  }

  return (
    <div className="filetree-section-body">
      {rootEntries.map((entry) =>
        entry.isDir ? (
          <FileTreeDirNode
            key={entry.path}
            entry={entry}
            depth={0}
            projectPath={projectPath}
          />
        ) : (
          <FileTreeFileNode key={entry.path} entry={entry} depth={0} />
        ),
      )}
    </div>
  );
}
