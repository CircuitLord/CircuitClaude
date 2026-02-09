import { useEffect, useRef, useCallback } from "react";
import { useNotesStore } from "../stores/notesStore";
import { useSessionStore } from "../stores/sessionStore";

export function NotesPanel() {
  const { isOpen, content, loading, saving, dirty, setContent, save, toggle, loadForProject } =
    useNotesStore();
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevProjectRef = useRef<string | null>(null);

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
    <div className="notes-panel">
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
          <textarea
            ref={textareaRef}
            className="notes-panel-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="jot ideas here..."
            spellCheck={false}
          />
        )}
      </div>
      <div className="notes-panel-footer">
        <span className="notes-panel-hint">ctrl+s save</span>
      </div>
    </div>
  );
}
