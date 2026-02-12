import { useEffect, useRef, useCallback, useMemo } from "react";
import { useNotesStore } from "../stores/notesStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import hljs from "highlight.js/lib/core";
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("markdown", markdown);

const MIN_WIDTH = 200;
const MAX_WIDTH = 800;

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
  const { isOpen, content, loading, saving, dirty, setContent, save, toggle, loadForProject } =
    useNotesStore();
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const width = useSettingsStore((s) => s.settings.notesPanelWidth);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const prevProjectRef = useRef<string | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Load notes when project changes
  useEffect(() => {
    if (!activeProjectPath || !isOpen) return;
    if (prevProjectRef.current === activeProjectPath) return;
    prevProjectRef.current = activeProjectPath;
    loadForProject(activeProjectPath);
  }, [activeProjectPath, isOpen, loadForProject]);

  // Reset tracking ref when panel closes
  useEffect(() => {
    if (!isOpen) {
      prevProjectRef.current = null;
    }
  }, [isOpen]);

  // Auto-focus textarea when panel opens
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

  // Resize drag handling
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - e.clientX;
      const newWidth = Math.min(Math.max(MIN_WIDTH, dragRef.current.startWidth + delta), MAX_WIDTH);
      useSettingsStore.getState().update({ notesPanelWidth: newWidth });
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
    dragRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

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

  if (!isOpen) return null;

  return (
    <div className="notes-panel" style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}>
      <div className="resize-handle-vertical" onMouseDown={onResizeStart} />
      <div className="notes-panel-header">
        <span className="notes-panel-path">~/notes</span>
        <div className="notes-panel-actions">
          {saving && <span className="notes-panel-status">saving...</span>}
          {dirty && !saving && <span className="notes-panel-dot">*</span>}
          <button className="notes-panel-close" onClick={toggle}>
            :close
          </button>
        </div>
      </div>
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
    </div>
  );
}
