import { useEffect, useRef } from "react";
import { useGitStore, fileKey } from "../stores/gitStore";
import { statusColor, displayStatus } from "./GitSection";
import { DiffStat } from "../types";

interface CommitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
}

export function CommitDialog({ isOpen, onClose, projectPath }: CommitDialogProps) {
  const {
    selectedFiles,
    statuses,
    commitMessage,
    setCommitMessage,
    commitSelected,
    commitAndPush,
    committing,
    pushing,
    diffStats,
    diffStatsLoading,
    commitError,
    generatingMessage,
    generateCommitMessage,
  } = useGitStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const status = statuses[projectPath];
  const selectedEntries = status?.files.filter((f) => selectedFiles[fileKey(f)]) ?? [];
  const selCount = selectedEntries.length;
  const canCommit = selCount > 0 && commitMessage.trim().length > 0 && !committing && !pushing && !generatingMessage;

  // Build a lookup for diff stats by path
  const statsMap = new Map<string, DiffStat>();
  for (const s of diffStats) {
    statsMap.set(s.path, s);
  }

  const handleCommit = () => {
    if (!canCommit) return;
    commitSelected(projectPath);
  };

  const handleCommitAndPush = () => {
    if (!canCommit) return;
    commitAndPush(projectPath);
  };

  const busy = committing || pushing;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="commit-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="commit-dialog-header">
          <span className="commit-dialog-header-title">commit [{selCount}]</span>
          <button className="commit-dialog-close" onClick={onClose}>:esc</button>
        </div>
        <div className="commit-dialog-body">
          <div className="commit-dialog-files">
            {selectedEntries.map((f) => {
              const stat = statsMap.get(f.path);
              return (
                <div className="commit-dialog-file" key={`${f.path}:${f.staged}`}>
                  <span className="commit-dialog-file-status" style={{ color: statusColor(f.status) }}>
                    {displayStatus(f.status)}
                  </span>
                  <span className="commit-dialog-file-path">{f.path}</span>
                  {diffStatsLoading ? (
                    <span className="commit-dialog-stat-loading">...</span>
                  ) : stat ? (
                    <span className="commit-dialog-file-stats">
                      <span className="commit-dialog-stat-add">+{stat.insertions}</span>
                      {" "}
                      <span className="commit-dialog-stat-del">-{stat.deletions}</span>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="commit-dialog-generate-row">
            <button
              className={`commit-dialog-generate-btn${generatingMessage ? " commit-dialog-generating" : ""}`}
              disabled={committing || pushing || generatingMessage || diffStatsLoading}
              onClick={() => generateCommitMessage(projectPath)}
            >
              {generatingMessage ? ":generating..." : ":generate"}
            </button>
          </div>
          <textarea
            ref={textareaRef}
            className="commit-dialog-message"
            rows={6}
            placeholder="> commit message..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) {
                e.preventDefault();
                handleCommit();
              }
            }}
            disabled={busy || generatingMessage}
          />
          {commitError && (
            <div className="commit-dialog-error">{commitError}</div>
          )}
          <div className="commit-dialog-actions">
            <button
              className="git-action-btn"
              disabled={!canCommit}
              onClick={handleCommit}
            >
              {committing ? ":committing..." : ":commit"}
            </button>
            <button
              className="git-action-btn"
              disabled={!canCommit}
              onClick={handleCommitAndPush}
            >
              {pushing ? ":pushing..." : ":commit & push"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
