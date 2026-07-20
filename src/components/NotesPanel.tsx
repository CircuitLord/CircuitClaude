import { useEffect, useRef, useCallback, useMemo } from "react";
import { useNotesStore } from "../stores/notesStore";
import { useSessionStore } from "../stores/sessionStore";
import hljs from "highlight.js/lib/core";
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("markdown", markdown);

const INTRAWORD_UNDERSCORE_PLACEHOLDER = "\uE001";

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

export function NotesPanel() {
  const { content, loading, saving, dirty, setContent, save, loadForProject } =
    useNotesStore();
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const prevProjectRef = useRef<string | null>(null);

  // Load notes when project changes
  useEffect(() => {
    if (!activeProjectPath) return;
    if (prevProjectRef.current === activeProjectPath) return;
    prevProjectRef.current = activeProjectPath;
    loadForProject(activeProjectPath);
  }, [activeProjectPath, loadForProject]);

  // Auto-focus textarea when panel opens
  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopPropagation();
        save();
      }
    },
    [save]
  );

  return (
    <>
      <div className="right-panel-header">
        <span className="right-panel-title">~/notes</span>
        <div className="right-panel-header-actions">
          {saving && <span className="notes-panel-status">saving...</span>}
          {dirty && !saving && <span className="notes-panel-dot">*</span>}
        </div>
      </div>
      <div className="sidebar-divider" />
      <div className="notes-panel-body">
        {loading ? (
          <div className="notes-panel-loading">loading...</div>
        ) : (
          <div className="notes-panel-code">
            <pre
              ref={highlightRef}
              className="notes-panel-highlight md-highlight"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightedHtml + "\n" }}
            />
            <textarea
              ref={textareaRef}
              className="notes-panel-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              placeholder="jot ideas here..."
              spellCheck={false}
            />
          </div>
        )}
      </div>
      <div className="notes-panel-footer">
        <span className="notes-panel-hint">ctrl+s save</span>
      </div>
    </>
  );
}
