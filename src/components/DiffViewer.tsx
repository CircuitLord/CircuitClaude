import { useEffect, useCallback, useMemo } from "react";
import { useGitStore } from "../stores/gitStore";
import { statusColor } from "./GitSection";
import { highlightCode, detectLanguage } from "../lib/highlight";

interface DiffLine {
  prefix: string;
  code: string;
  cls: string;
  oldNum: number | null;
  newNum: number | null;
  highlight: boolean;
}

function parseLines(raw: string): DiffLine[] {
  const result: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNum = parseInt(m[1], 10);
        newNum = parseInt(m[2], 10);
      }
      result.push({ prefix: "", code: line, cls: "diff-line-hunk", oldNum: null, newNum: null, highlight: false });
    } else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      result.push({ prefix: "", code: line, cls: "diff-line-meta", oldNum: null, newNum: null, highlight: false });
    } else if (line.startsWith("+")) {
      result.push({ prefix: "+", code: line.slice(1), cls: "diff-line-add", oldNum: null, newNum: newNum, highlight: true });
      newNum++;
    } else if (line.startsWith("-")) {
      result.push({ prefix: "-", code: line.slice(1), cls: "diff-line-del", oldNum: oldNum, newNum: null, highlight: true });
      oldNum++;
    } else {
      const code = line.startsWith(" ") ? line.slice(1) : line;
      result.push({ prefix: " ", code, cls: "diff-line-context", oldNum: oldNum, newNum: newNum, highlight: true });
      oldNum++;
      newNum++;
    }
  }

  return result;
}

export function DiffViewer() {
  const { diffFile, diffContent, diffLoading, closeDiff } = useGitStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDiff();
    },
    [closeDiff]
  );

  useEffect(() => {
    if (!diffFile) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diffFile, handleKeyDown]);

  const language = diffFile ? detectLanguage(diffFile.path) : undefined;

  const lines = useMemo(() => {
    if (!diffContent) return [];
    return parseLines(diffContent);
  }, [diffContent]);

  const isEmpty = diffContent !== null && diffContent.trim() === "";

  if (!diffFile) return null;

  return (
    <div className="diff-overlay" onClick={closeDiff}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <span className="diff-header-status" style={{ color: statusColor(diffFile.status) }}>
            {diffFile.status}
          </span>
          <span className="diff-header-path">{diffFile.path}</span>
          {diffFile.staged && <span className="diff-header-badge">Staged</span>}
          <button className="diff-close-btn" onClick={closeDiff}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>
        <div className="diff-body">
          {diffLoading ? (
            <div className="diff-empty">Loading...</div>
          ) : isEmpty ? (
            <div className="diff-empty">No changes</div>
          ) : (
            <pre className="diff-content">
              {lines.map((line, i) =>
                line.highlight ? (
                  <div key={i} className={line.cls}>
                    <span className="diff-ln diff-ln-old">{line.oldNum ?? ""}</span>
                    <span className="diff-ln diff-ln-new">{line.newNum ?? ""}</span>
                    <span className="diff-prefix">{line.prefix}</span>
                    <span
                      className="diff-ln-text"
                      dangerouslySetInnerHTML={{ __html: highlightCode(line.code, language) }}
                    />
                  </div>
                ) : (
                  <div key={i} className={line.cls}>
                    <span className="diff-ln diff-ln-old">{line.oldNum ?? ""}</span>
                    <span className="diff-ln diff-ln-new">{line.newNum ?? ""}</span>
                    <span className="diff-ln-text">{line.code}</span>
                  </div>
                )
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
