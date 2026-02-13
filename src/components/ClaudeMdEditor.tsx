import { useEffect, useCallback, useRef, useMemo } from "react";
import { useClaudeMdStore } from "../stores/claudeMdStore";
import hljs from "highlight.js/lib/core";
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("markdown", markdown);

const INTRAWORD_UNDERSCORE_PLACEHOLDER = "\uE000";

function protectIntrawordUnderscores(text: string): string {
  return text.replace(/_(?=[A-Za-z0-9])/g, (match, offset, source) => {
    const previousChar = source[offset - 1] ?? "";
    return /[A-Za-z0-9]/.test(previousChar)
      ? INTRAWORD_UNDERSCORE_PLACEHOLDER
      : match;
  });
}

function restoreIntrawordUnderscores(text: string): string {
  return text.replace(
    new RegExp(INTRAWORD_UNDERSCORE_PLACEHOLDER, "g"),
    "&#95;"
  );
}

export function ClaudeMdEditor() {
  const { isOpen, filePath, content, loading, saving, error, close, setContent, save } =
    useClaudeMdStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    },
    [close, save]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Auto-focus textarea when content loads
  useEffect(() => {
    if (isOpen && !loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen, loading]);

  // Sync scroll from textarea to highlight layer
  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const highlightedHtml = useMemo(() => {
    if (!content) return "";
    try {
      const highlightInput = protectIntrawordUnderscores(content);
      return restoreIntrawordUnderscores(
        hljs.highlight(highlightInput, { language: "markdown" }).value
      );
    } catch {
      return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [content]);

  if (!isOpen) return null;

  const fileName = filePath.endsWith("agents.md")
    ? filePath.includes("/.claude/agents.md") || filePath.includes("\\.claude\\agents.md")
      ? "~/.claude/agents.md"
      : filePath.replace(/\\/g, "/").split("/").slice(-2).join("/")
    : filePath.includes(".claude")
      ? "~/.claude/CLAUDE.md"
      : filePath.replace(/\\/g, "/").split("/").slice(-2).join("/");

  return (
    <div className="dialog-overlay" onMouseDown={close}>
      <div className="claude-md-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="claude-md-editor-header">
          <span className="claude-md-editor-path">{fileName}</span>
          <div className="claude-md-editor-actions">
            {saving && <span className="claude-md-editor-status">saving...</span>}
            <button
              className="claude-md-editor-save-btn"
              onClick={save}
              disabled={saving}
            >
              :save
            </button>
            <button className="claude-md-editor-close" onClick={close}>
              :esc
            </button>
          </div>
        </div>
        <div className="claude-md-editor-body">
          {loading ? (
            <div className="claude-md-editor-loading">loading...</div>
          ) : error ? (
            <div className="claude-md-editor-error">{error}</div>
          ) : (
            <div className="claude-md-editor-code">
              <pre
                ref={highlightRef}
                className="claude-md-editor-highlight md-highlight"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: highlightedHtml + "\n" }}
              />
              <textarea
                ref={textareaRef}
                className="claude-md-editor-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={handleScroll}
                spellCheck={false}
              />
            </div>
          )}
        </div>
        <div className="claude-md-editor-footer">
          <span className="claude-md-editor-hint">ctrl+s save</span>
          <span className="claude-md-editor-hint">esc close</span>
        </div>
      </div>
    </div>
  );
}
